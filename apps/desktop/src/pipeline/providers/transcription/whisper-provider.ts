import {
  TranscriptionProvider,
  TranscribeParams,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { ModelManagerService } from "../../../services/model-manager";
import { Whisper } from "smart-whisper";

export class WhisperProvider implements TranscriptionProvider {
  readonly name = "whisper-local";

  private modelManager: ModelManagerService;
  private whisperInstance: Whisper | null = null;

  // Frame aggregation state
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = []; // Track speech probabilities for each frame
  private silenceFrameCount = 0;
  private lastSpeechTimestamp = 0;

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_SPEECH_DURATION_MS = 500; // Minimum speech duration to transcribe
  private readonly MAX_SILENCE_DURATION_MS = 800; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2; // Threshold for speech detection

  constructor(modelManager: ModelManagerService) {
    this.modelManager = modelManager;
  }

  /**
   * Preload the Whisper model into memory
   */
  async preloadModel(): Promise<void> {
    await this.initializeWhisper();
  }

  async transcribe(params: TranscribeParams): Promise<string> {
    try {
      await this.initializeWhisper();

      // Extract parameters from the new structure
      const { audioData, speechProbability = 0, context } = params;
      const { vocabulary, previousChunk, aggregatedTranscription } = context;

      // Convert audio buffer to the format expected by smart-whisper
      const audioFloat32Array = await this.convertAudioBuffer(audioData);

      // Add frame to buffer with speech probability
      this.frameBuffer.push(audioFloat32Array);
      this.frameBufferSpeechProbabilities.push(speechProbability);

      // Consider it speech if probability is above threshold
      const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;

      logger.transcription.debug(
        `Frame received - SpeechProb: ${speechProbability.toFixed(3)}, Buffer size: ${this.frameBuffer.length}, Silence count: ${this.silenceFrameCount}`,
      );

      // Handle speech/silence logic
      if (isSpeech) {
        this.silenceFrameCount = 0;
        this.lastSpeechTimestamp = Date.now();
      } else {
        this.silenceFrameCount++;
      }

      // Determine if we should transcribe
      const shouldTranscribe = this.shouldTranscribe();

      if (!shouldTranscribe) {
        // Keep buffering
        return "";
      }

      // Aggregate buffered frames
      const aggregatedAudio = this.aggregateFrames();

      // Skip if too short or only silence
      /* if (aggregatedAudio.length < this.FRAME_SIZE * 2) {
        logger.transcription.debug("Skipping transcription - audio too short");
        this.frameBuffer = [];
        this.frameBufferSpeechProbabilities = [];
        this.silenceFrameCount = 0;
        return "";
      } */

      logger.transcription.debug(
        `Starting transcription of ${aggregatedAudio.length} samples (${((aggregatedAudio.length / this.SAMPLE_RATE) * 1000).toFixed(0)}ms)`,
      );

      // Transcribe using smart-whisper
      if (!this.whisperInstance) {
        throw new Error("Whisper instance is not initialized");
      }

      // Generate initial prompt from vocabulary and recent context
      const initialPrompt = this.generateInitialPrompt(
        vocabulary,
        aggregatedTranscription,
      );

      const { result } = await this.whisperInstance.transcribe(
        aggregatedAudio,
        {
          language: "auto",
          initial_prompt: initialPrompt,
          suppress_blank: true,
          suppress_non_speech_tokens: true,
          no_timestamps: true,
        },
      );

      const transcription = await result;

      // Combine all transcription segments into a single string
      const text = transcription
        .map((segment) => segment.text)
        .join(" ")
        .trim();

      logger.transcription.debug(
        `Transcription completed, length: ${text.length}`,
      );

      // Clear buffer after successful transcription
      this.frameBuffer = [];
      this.frameBufferSpeechProbabilities = [];
      this.silenceFrameCount = 0;

      return text;
    } catch (error) {
      logger.transcription.error("Transcription failed:", error);
      throw new Error(`Transcription failed: ${error}`);
    }
  }

  private shouldTranscribe(): boolean {
    // Transcribe if:
    // 1. We have significant silence after speech
    // 2. Buffer is getting too large
    // 3. Final chunk was received (handled elsewhere)

    const bufferDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.silenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;

    // If we have speech and then significant silence, transcribe
    if (
      this.frameBuffer.length > 0 &&
      silenceDurationMs > this.MAX_SILENCE_DURATION_MS
    ) {
      logger.transcription.debug(
        `Transcribing due to ${silenceDurationMs}ms of silence`,
      );
      return true;
    }

    // If buffer is too large (e.g., 30 seconds), transcribe anyway
    if (bufferDurationMs > 30000) {
      logger.transcription.debug(
        `Transcribing due to buffer size: ${bufferDurationMs}ms`,
      );
      return true;
    }

    logger.transcription.error("Not transcribing", {
      bufferDurationMs,
      silenceDurationMs,
      frameBufferLength: this.frameBuffer.length,
      silenceFrameCount: this.silenceFrameCount,
    });

    return false;
  }

  private aggregateFrames(): Float32Array {
    // Calculate total size
    const totalLength = this.frameBuffer.reduce(
      (sum, frame) => sum + frame.length,
      0,
    );
    const aggregated = new Float32Array(totalLength);

    // Copy all frames into single array
    let offset = 0;
    for (const frame of this.frameBuffer) {
      aggregated.set(frame, offset);
      offset += frame.length;
    }

    // Trim silence from beginning and end
    const trimmed = this.trimSilence(aggregated);

    return trimmed;
  }

  private trimSilence(audio: Float32Array): Float32Array {
    // Find first speech frame (probability > threshold)
    let startIdx = 0;
    for (let i = 0; i < this.frameBufferSpeechProbabilities.length; i++) {
      if (
        this.frameBufferSpeechProbabilities[i] >
        this.SPEECH_PROBABILITY_THRESHOLD
      ) {
        startIdx = i * this.FRAME_SIZE;
        break;
      }
    }

    // Find last speech frame (probability > threshold)
    let endIdx = audio.length;
    for (let i = this.frameBufferSpeechProbabilities.length - 1; i >= 0; i--) {
      if (
        this.frameBufferSpeechProbabilities[i] >
        this.SPEECH_PROBABILITY_THRESHOLD
      ) {
        endIdx = (i + 1) * this.FRAME_SIZE;
        break;
      }
    }

    return audio.slice(startIdx, Math.min(endIdx, audio.length));
  }

  // Force transcription of any remaining frames
  async flush(): Promise<string> {
    if (this.frameBuffer.length === 0) {
      return "";
    }

    logger.transcription.error(`Flushing ${this.frameBuffer.length} frames`);

    // Force transcription by setting high silence count
    this.silenceFrameCount = 999;
    return this.transcribe({
      audioData: Buffer.alloc(0), // Empty buffer, we'll use the buffered frames
      speechProbability: 0,
      context: {},
    });
  }

  private generateInitialPrompt(
    vocabulary?: Map<string, string>,
    aggregatedTranscription?: string,
  ): string {
    const promptParts: string[] = [];

    // Add vocabulary terms if available
    if (vocabulary && vocabulary.size > 0) {
      // Extract vocabulary keys (the actual terms) and join with commas
      const vocabularyTerms = Array.from(vocabulary.keys());
      const vocabularyText = vocabularyTerms.join(", ");
      promptParts.push(vocabularyText);
    }

    // Add last 8 words from aggregated transcription if available
    if (aggregatedTranscription && aggregatedTranscription.trim().length > 0) {
      const words = aggregatedTranscription.trim().split(/\s+/);
      const lastWords = words.slice(-8).join(" ");
      if (lastWords.length > 0) {
        promptParts.push(lastWords);
      }
    }

    // Combine parts with a separator, or return empty string if no context
    const prompt = promptParts.join(". ");

    logger.transcription.debug(`Generated initial prompt: "${prompt}"`);

    return prompt;
  }

  async initializeWhisper(): Promise<void> {
    if (this.whisperInstance) {
      return; // Already initialized
    }

    const modelPath = await this.modelManager.getBestAvailableModelPath();
    if (!modelPath) {
      throw new Error(
        "No Whisper models available. Please download a model first.",
      );
    }

    try {
      const { Whisper } = await import("smart-whisper");
      this.whisperInstance = new Whisper(modelPath, { gpu: true });
      this.whisperInstance.load();
      logger.transcription.info(`Initialized with model: ${modelPath}`);
    } catch (error) {
      logger.transcription.error(`Failed to initialize:`, error);
      throw new Error(`Failed to initialize smart-whisper: ${error}`);
    }
  }

  private async convertAudioBuffer(audioData: Buffer): Promise<Float32Array> {
    try {
      // Convert buffer to Float32Array (simplified)
      const float32Array = new Float32Array(audioData.length / 4);
      for (let i = 0; i < float32Array.length; i++) {
        float32Array[i] = audioData.readFloatLE(i * 4);
      }
      return float32Array;
    } catch (error) {
      logger.transcription.warn(
        "Audio conversion failed, trying alternative method",
      );

      // Fallback: convert as if it's PCM data
      const samples = new Float32Array(audioData.length / 2);
      for (let i = 0; i < samples.length; i++) {
        const sample = audioData.readInt16LE(i * 2);
        samples[i] = sample / 32768.0;
      }
      return samples;
    }
  }

  // Simple cleanup method
  async dispose(): Promise<void> {
    if (this.whisperInstance) {
      try {
        await this.whisperInstance.free();
        logger.transcription.debug("Instance freed");
      } catch (error) {
        logger.transcription.warn("Error freeing instance:", error);
      } finally {
        this.whisperInstance = null;
      }
    }

    // Clear buffers
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.silenceFrameCount = 0;
  }
}
