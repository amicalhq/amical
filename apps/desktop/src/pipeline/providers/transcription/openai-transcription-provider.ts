import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { convertRawToWav } from "../../../utils/audio-converter";

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly name: string;

  private apiKey: string;
  private apiModelId: string;
  private apiEndpoint: string;

  // Frame aggregation state (same pattern as WhisperProvider / AmicalCloudProvider)
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;
  private lastSpeechTimestamp = 0;

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;
  private readonly IGNORE_FULLY_SILENT_CHUNKS = true;
  private readonly MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB limit for OpenAI-compatible APIs

  constructor(
    apiKey: string,
    apiModelId: string,
    apiEndpoint: string,
    name: string,
  ) {
    this.apiKey = apiKey;
    this.apiModelId = apiModelId;
    this.apiEndpoint = apiEndpoint;
    this.name = name;

    logger.transcription.info(`${this.name} provider initialized`, {
      endpoint: this.apiEndpoint,
      model: this.apiModelId,
    });
  }

  async transcribe(params: TranscribeParams): Promise<string> {
    const { audioData, speechProbability = 1, context } = params;

    // Add frame to buffer with speech probability
    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    // Consider it speech if probability is above threshold
    const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;

    if (isSpeech) {
      this.currentSilenceFrameCount = 0;
      this.lastSpeechTimestamp = Date.now();
    } else {
      this.currentSilenceFrameCount++;
    }

    // Only transcribe if speech/silence patterns indicate we should
    if (!this.shouldTranscribe()) {
      return "";
    }

    return this.doTranscription(context);
  }

  async flush(context: TranscribeContext): Promise<string> {
    if (this.frameBuffer.length === 0) {
      return "";
    }
    return this.doTranscription(context);
  }

  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private shouldTranscribe(): boolean {
    const bufferDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    // If we have speech and then significant silence, transcribe
    if (
      this.frameBuffer.length > 0 &&
      silenceDurationMs > this.MAX_SILENCE_DURATION_MS
    ) {
      return true;
    }

    // If buffer is too large (30 seconds), transcribe anyway
    if (bufferDurationMs > 30000) {
      return true;
    }

    return false;
  }

  private async doTranscription(context: TranscribeContext): Promise<string> {
    try {
      const { vocabulary, aggregatedTranscription, language } = context;

      const isAllSilent = this.isAllSilent();

      // Aggregate buffered frames into a single Float32Array
      const aggregatedAudio = this.aggregateFrames();

      // Clear buffers immediately after aggregation
      this.reset();

      if (isAllSilent && this.IGNORE_FULLY_SILENT_CHUNKS) {
        logger.transcription.debug(
          `[${this.name}] Skipping transcription - all silent`,
        );
        return "";
      }

      // Convert Float32Array to WAV buffer
      const rawBuffer = Buffer.from(
        aggregatedAudio.buffer,
        aggregatedAudio.byteOffset,
        aggregatedAudio.byteLength,
      );
      const wavBuffer = convertRawToWav(rawBuffer, this.SAMPLE_RATE);

      // Check file size limit
      if (wavBuffer.length > this.MAX_FILE_SIZE_BYTES) {
        logger.transcription.error(
          `[${this.name}] Audio file too large: ${wavBuffer.length} bytes (max ${this.MAX_FILE_SIZE_BYTES})`,
        );
        throw new Error(
          `Audio file exceeds the ${this.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`,
        );
      }

      logger.transcription.debug(
        `[${this.name}] Sending ${aggregatedAudio.length} samples (${((aggregatedAudio.length / this.SAMPLE_RATE) * 1000).toFixed(0)}ms) to API`,
      );

      // Build FormData for the OpenAI-compatible API
      const formData = new FormData();
      const audioBlob = new Blob([wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer], { type: "audio/wav" });
      formData.append("file", audioBlob, "audio.wav");
      formData.append("model", this.apiModelId);

      // Set language if specified and not "auto"
      if (language && language !== "auto") {
        formData.append("language", language);
      }

      // Build prompt from vocabulary and aggregated transcription
      const prompt = this.generatePrompt(vocabulary, aggregatedTranscription);
      if (prompt) {
        formData.append("prompt", prompt);
      }

      const response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (response.status === 401) {
        throw new Error(
          `Authentication failed for ${this.name}. Please check your API key.`,
        );
      }

      if (response.status === 429) {
        throw new Error(`Rate limit exceeded for ${this.name}.`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.transcription.error(`[${this.name}] API error:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(
          `${this.name} API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();
      const text = result.text || "";

      logger.transcription.debug(
        `[${this.name}] Transcription completed, length: ${text.length}`,
      );

      return text;
    } catch (error) {
      logger.transcription.error(`[${this.name}] Transcription failed:`, error);
      throw error;
    }
  }

  private aggregateFrames(): Float32Array {
    const totalLength = this.frameBuffer.reduce(
      (sum, frame) => sum + frame.length,
      0,
    );
    const aggregated = new Float32Array(totalLength);

    let offset = 0;
    for (const frame of this.frameBuffer) {
      aggregated.set(frame, offset);
      offset += frame.length;
    }

    return aggregated;
  }

  private isAllSilent(): boolean {
    const bufferDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    return bufferDurationMs === silenceDurationMs;
  }

  private generatePrompt(
    vocabulary?: string[],
    aggregatedTranscription?: string,
  ): string {
    const parts: string[] = [];

    if (vocabulary && vocabulary.length > 0) {
      parts.push(vocabulary.join(", "));
    }

    if (aggregatedTranscription) {
      parts.push(aggregatedTranscription);
    }

    return parts.join(" ");
  }
}
