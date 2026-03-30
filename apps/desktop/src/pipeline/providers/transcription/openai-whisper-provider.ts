import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { SettingsService } from "../../../services/settings-service";
import { AppError, ErrorCodes } from "../../../types/error";
import { extractSpeechFromVad } from "../../utils/vad-audio-filter";
import { getUserAgent } from "../../../utils/http-client";

/**
 * Encode raw PCM Float32 samples into a WAV file buffer.
 * Output: 16-bit mono PCM WAV at the given sample rate.
 */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Sub-chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Convert Float32 [-1, 1] to Int16
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    buffer.writeInt16LE(Math.round(int16), headerSize + i * 2);
  }

  return buffer;
}

export class OpenAIWhisperProvider implements TranscriptionProvider {
  readonly name = "openai-whisper";

  private settingsService: SettingsService;

  // Frame aggregation state (same pattern as WhisperProvider)
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_AUDIO_DURATION_MS = 500;
  private readonly MAX_SILENCE_DURATION_MS = 3000;
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;
  private readonly OPENAI_API_URL =
    "https://api.openai.com/v1/audio/transcriptions";

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;

    logger.transcription.info("OpenAIWhisperProvider initialized");
  }

  /**
   * Process an audio chunk - buffers and conditionally transcribes
   */
  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    const { audioData, speechProbability = 1 } = params;

    // Add frame to buffer with speech probability
    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    // Consider it speech if probability is above threshold
    const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;

    if (isSpeech) {
      this.currentSilenceFrameCount = 0;
    } else {
      this.currentSilenceFrameCount++;
    }

    // Only transcribe if speech/silence patterns indicate we should
    if (!this.shouldTranscribe()) {
      return { text: "" };
    }

    return this.doTranscription(params.context);
  }

  /**
   * Flush any buffered audio and return transcription
   * Called at the end of a recording session
   */
  async flush(context: TranscribeContext): Promise<TranscriptionOutput> {
    if (this.frameBuffer.length === 0) {
      return { text: "" };
    }

    return this.doTranscription(context);
  }

  /**
   * Clear internal buffers without transcribing
   */
  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private shouldTranscribe(): boolean {
    const audioDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    if (
      audioDurationMs >= this.MIN_AUDIO_DURATION_MS &&
      silenceDurationMs > this.MAX_SILENCE_DURATION_MS
    ) {
      return true;
    }

    // If buffer is too large (30 seconds), transcribe anyway
    if (audioDurationMs > 30000) {
      return true;
    }

    return false;
  }

  private async doTranscription(
    context: TranscribeContext,
  ): Promise<TranscriptionOutput> {
    try {
      // Get API key
      const config = await this.settingsService.getOpenAIWhisperConfig();
      if (!config?.apiKey) {
        throw new AppError(
          "OpenAI API key not configured",
          ErrorCodes.AUTH_REQUIRED,
        );
      }

      // Capture speech probabilities before reset
      const vadProbs = [...this.frameBufferSpeechProbabilities];

      // Aggregate buffered frames
      const rawAudio = this.aggregateFrames();

      // Clear buffers immediately after aggregation
      this.reset();

      // Apply VAD filtering to extract speech-only portions
      const { audio: filteredAudio, segments: speechSegments } =
        extractSpeechFromVad(rawAudio, vadProbs);

      if (filteredAudio.length === 0) {
        logger.transcription.debug(
          "OpenAI Whisper: Skipping - no speech detected by VAD filter",
        );
        return { text: "" };
      }

      logger.transcription.debug(
        `OpenAI Whisper: VAD filtered ${rawAudio.length} -> ${filteredAudio.length} samples (${speechSegments.length} speech segments, ${((filteredAudio.length / rawAudio.length) * 100).toFixed(0)}% kept)`,
      );

      // Convert to WAV
      const wavBuffer = encodeWav(filteredAudio, this.SAMPLE_RATE);

      logger.transcription.info("Sending audio to OpenAI Whisper API", {
        audioSamples: filteredAudio.length,
        wavSizeBytes: wavBuffer.length,
        durationMs: (
          (filteredAudio.length / this.SAMPLE_RATE) *
          1000
        ).toFixed(0),
      });

      // Build form data
      const formData = new FormData();
      const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
      formData.append("file", wavBlob, "audio.wav");
      formData.append("model", "whisper-1");

      // Pass language hint if available (ISO 639-1 code)
      if (context.language && context.language !== "auto") {
        formData.append("language", context.language);
      }

      // Pass previous transcription as prompt for context continuity
      if (context.aggregatedTranscription?.trim()) {
        formData.append("prompt", context.aggregatedTranscription);
      }

      // Set response format to plain text for simplicity
      formData.append("response_format", "text");

      // Make the API request (60s timeout)
      let response: Response;
      try {
        response = await fetch(this.OPENAI_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "User-Agent": getUserAgent(),
          },
          body: formData,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (fetchError) {
        throw new AppError(
          fetchError instanceof Error ? fetchError.message : "Network error",
          ErrorCodes.NETWORK_ERROR,
        );
      }

      if (!response.ok) {
        let errorMessage = `OpenAI API error: ${response.status} ${response.statusText}`;
        try {
          const errorBody = await response.json();
          if (errorBody?.error?.message) {
            errorMessage = errorBody.error.message;
          }
        } catch {
          // Response body wasn't valid JSON
        }

        logger.transcription.error("OpenAI Whisper API error:", {
          status: response.status,
          errorMessage,
        });

        if (response.status === 401) {
          throw new AppError(errorMessage, ErrorCodes.AUTH_REQUIRED, 401);
        } else if (response.status === 429) {
          throw new AppError(
            errorMessage,
            ErrorCodes.RATE_LIMIT_EXCEEDED,
            429,
          );
        } else {
          throw new AppError(
            errorMessage,
            ErrorCodes.CLOUD_TRANSCRIPTION_FAILED,
            response.status,
          );
        }
      }

      // response_format=text returns plain text
      const text = (await response.text()).trim();

      logger.transcription.info("OpenAI Whisper transcription successful", {
        textLength: text.length,
        preview: text.length > 100 ? text.slice(0, 100) + "…" : text,
      });

      return { text };
    } catch (error) {
      logger.transcription.error("OpenAI Whisper transcription error:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `OpenAI Whisper transcription failed: ${error instanceof Error ? error.message : error}`,
        ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
      );
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
}
