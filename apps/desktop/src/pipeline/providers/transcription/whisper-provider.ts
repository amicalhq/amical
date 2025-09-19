import {
  TranscriptionProvider,
  TranscribeParams,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { ModelManagerService } from "../../../services/model-manager";
import { SimpleForkWrapper } from "./simple-fork-wrapper";
import * as path from "path";
import { app } from "electron";

export class WhisperProvider implements TranscriptionProvider {
  readonly name = "whisper-local";

  private modelManager: ModelManagerService;
  private workerWrapper: SimpleForkWrapper | null = null;

  // Frame aggregation state
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = []; // Track speech probabilities for each frame
  private silenceFrameCount = 0;
  private lastSpeechTimestamp = 0;

  private getNodeBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const binaryName = platform === "win32" ? "node.exe" : "node";

    if (app.isPackaged) {
      // In production, use the binary from resources
      return path.join(process.resourcesPath, binaryName);
    } else {
      // In development, use the local binary
      return path.join(
        __dirname,
        "../../node-binaries",
        `${platform}-${arch}`,
        binaryName,
      );
    }
  }

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

  async getBindingInfo(): Promise<{ path: string; type: string } | null> {
    if (!this.workerWrapper) {
      return null;
    }
    try {
      return await this.workerWrapper.exec<{ path: string; type: string } | null>('getBindingInfo', []);
    } catch (error) {
      logger.transcription.warn('Failed to get binding info:', error);
      return null;
    }
  }

  async transcribe(
    params: TranscribeParams & { flush?: boolean },
  ): Promise<string> {
    try {
      await this.initializeWhisper();

      // Extract parameters from the new structure
      const {
        audioData,
        speechProbability = 0,
        context,
        flush = false,
      } = params;
      const { vocabulary, aggregatedTranscription } = context;

      // Audio data is already Float32Array

      // Add frame to buffer with speech probability
      this.frameBuffer.push(audioData);
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
      const shouldTranscribe = flush || this.shouldTranscribe();

      if (!shouldTranscribe) {
        // Keep buffering
        return "";
      }

      // Aggregate buffered frames
      const aggregatedAudio = this.aggregateFrames();

      // Clear buffers immediately after aggregation, before async operations
      this.frameBuffer = [];
      this.frameBufferSpeechProbabilities = [];
      this.silenceFrameCount = 0;

      // Skip if too short or only silence
      /* if (aggregatedAudio.length < this.FRAME_SIZE * 2) {
        logger.transcription.debug("Skipping transcription - audio too short");
        return "";
      } */

      logger.transcription.debug(
        `Starting transcription of ${aggregatedAudio.length} samples (${((aggregatedAudio.length / this.SAMPLE_RATE) * 1000).toFixed(0)}ms)`,
      );

      // Transcribe using the local Whisper wrapper
      if (!this.workerWrapper) {
        throw new Error("Worker wrapper is not initialized");
      }

      // Generate initial prompt from vocabulary and recent context
      const initialPrompt = this.generateInitialPrompt(
        vocabulary,
        aggregatedTranscription,
      );

      const text = await this.workerWrapper!.exec<string>("transcribeAudio", [
        aggregatedAudio,
        {
          language: "auto",
          initial_prompt: initialPrompt,
          suppress_blank: true,
          suppress_non_speech_tokens: true,
          no_timestamps: false,
        },
      ]);

      logger.transcription.debug(
        `Transcription completed, length: ${text.length}`,
      );

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

    logger.transcription.debug("Not transcribing", {
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
    if (!this.workerWrapper) {
      // Determine the correct path for the worker script
      const workerPath = app.isPackaged
        ? path.join(__dirname, "whisper-worker-fork.js") // In production, same directory as main.js
        : path.join(process.cwd(), ".vite/build/whisper-worker-fork.js"); // In development

      logger.transcription.info(
        `Initializing Whisper worker at: ${workerPath}`,
      );

      this.workerWrapper = new SimpleForkWrapper(
        workerPath,
        this.getNodeBinaryPath(),
      );

      await this.workerWrapper.initialize();
    }

    const modelPath = await this.modelManager.getBestAvailableModelPath();
    if (!modelPath) {
      throw new Error(
        "No Whisper models available. Please download a model first.",
      );
    }

    try {
      await this.workerWrapper.exec("initializeModel", [modelPath]);
    } catch (error) {
      logger.transcription.error(`Failed to initialize:`, error);
      throw new Error(`Failed to initialize whisper wrapper: ${error}`);
    }
  }

  // Simple cleanup method
  async dispose(): Promise<void> {
    if (this.workerWrapper) {
      try {
        await this.workerWrapper.exec("dispose", []);
        await this.workerWrapper.terminate(); // Terminate the worker
        logger.transcription.debug("Worker terminated");
      } catch (error) {
        logger.transcription.warn("Error disposing worker:", error);
      } finally {
        this.workerWrapper = null;
      }
    }

    // Clear buffers
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.silenceFrameCount = 0;
  }
}
