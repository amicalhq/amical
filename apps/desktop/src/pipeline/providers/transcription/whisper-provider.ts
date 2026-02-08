import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { ModelService } from "../../../services/model-service";
import { SimpleForkWrapper } from "./simple-fork-wrapper";
import * as path from "path";
import { app } from "electron";

export class WhisperProvider implements TranscriptionProvider {
  readonly name = "whisper-local";

  private modelService: ModelService;
  private preferredModelId?: string;
  private workerWrapper: SimpleForkWrapper | null = null;

  // Frame aggregation state
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = []; // Track speech probabilities for each frame
  private currentSilenceFrameCount = 0;
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
  private readonly TRIM_TRAILING_AND_LEADING_SILENCE = false;
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_SPEECH_DURATION_MS = 500; // Minimum speech duration to transcribe
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2; // Threshold for speech detection
  private readonly IGNORE_FULLY_SILENT_CHUNKS = true;

  constructor(modelService: ModelService, preferredModelId?: string) {
    this.modelService = modelService;
    this.preferredModelId = preferredModelId;
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
      return await this.workerWrapper.exec<{
        path: string;
        type: string;
      } | null>("getBindingInfo", []);
    } catch (error) {
      logger.transcription.warn("Failed to get binding info:", error);
      return null;
    }
  }

  /**
   * Process an audio chunk - buffers and conditionally transcribes
   */
  async transcribe(params: TranscribeParams): Promise<string> {
    await this.initializeWhisper();

    const { audioData, speechProbability = 1, context } = params;

    // Add frame to buffer with speech probability
    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    // Consider it speech if probability is above threshold
    const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;

    logger.transcription.debug(
      `Frame received - SpeechProb: ${speechProbability.toFixed(3)}, Buffer size: ${this.frameBuffer.length}, Silence count: ${this.currentSilenceFrameCount}`,
    );

    // Handle speech/silence logic
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

  /**
   * Flush any buffered audio and return transcription
   * Called at the end of a recording session
   */
  async flush(context: TranscribeContext): Promise<string> {
    if (this.frameBuffer.length === 0) {
      return "";
    }

    await this.initializeWhisper();
    return this.doTranscription(context);
  }

  /**
   * Shared transcription logic - aggregates buffer, calls whisper, clears state
   * Assumes initializeWhisper() was already called by caller
   */
  private async doTranscription(context: TranscribeContext): Promise<string> {
    try {
      const { vocabulary, aggregatedTranscription, language } = context;

      const isAllSilent = this.isAllSilent();

      // Aggregate buffered frames
      const aggregatedAudio = this.aggregateFrames();

      // Clear buffers immediately after aggregation
      this.reset();

      if (isAllSilent && this.IGNORE_FULLY_SILENT_CHUNKS) {
        logger.transcription.debug("Skipping transcription - all silent");
        return "";
      }

      logger.transcription.debug(
        `Starting transcription of ${aggregatedAudio.length} samples (${((aggregatedAudio.length / this.SAMPLE_RATE) * 1000).toFixed(0)}ms)`,
      );

      if (!this.workerWrapper) {
        throw new Error("Worker wrapper is not initialized");
      }

      // Generate initial prompt from vocabulary and recent context
      const initialPrompt = this.generateInitialPrompt(
        vocabulary,
        aggregatedTranscription,
        context.accessibilityContext,
      );

      const text = await this.workerWrapper.exec<string>("transcribeAudio", [
        aggregatedAudio,
        {
          language: language || "auto",
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

  /**
   * Clear internal buffers without transcribing
   * Called when cancelling a session to prevent audio bleed
   */
  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private shouldTranscribe(): boolean {
    // Transcribe if:
    // 1. We have significant silence after speech
    // 2. Buffer is getting too large

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
      silenceFrameCount: this.currentSilenceFrameCount,
    });

    return false;
  }

  private aggregateFrames(): Float32Array {
    // Calculate total size
    const totalLength = this.frameBuffer.reduce(
      (sum, frame) => sum + frame.length,
      0,
    );
    let aggregated = new Float32Array(totalLength);

    // Copy all frames into single array
    let offset = 0;
    for (const frame of this.frameBuffer) {
      aggregated.set(frame, offset);
      offset += frame.length;
    }

    // Trim silence from beginning and end
    aggregated = this.TRIM_TRAILING_AND_LEADING_SILENCE
      ? this.trimSilence(aggregated)
      : aggregated;

    return aggregated;
  }

  private isAllSilent = () => {
    const bufferDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    return bufferDurationMs === silenceDurationMs;
  };

  private trimSilence(
    audio: Float32Array<ArrayBuffer>,
  ): Float32Array<ArrayBuffer> {
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
    vocabulary?: string[],
    aggregatedTranscription?: string,
    accessibilityContext?: TranscribeContext["accessibilityContext"],
  ): string {
    const promptParts: string[] = [];

    // Add vocabulary terms if available
    if (vocabulary && vocabulary.length > 0) {
      promptParts.push(vocabulary.join(", "));
    }

    if (aggregatedTranscription) {
      // Pass full transcription - whisper.cpp auto-truncates to last ~224 tokens
      promptParts.push(aggregatedTranscription);
    } else {
      const beforeText =
        accessibilityContext?.context?.textSelection?.preSelectionText;
      if (beforeText && beforeText.trim().length > 0) {
        promptParts.push(beforeText);
      }
    }

    // Combine parts with a separator, or return empty string if no context
    const prompt = promptParts.join(" ");

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

    let modelPath: string | null = null;

    if (this.preferredModelId) {
      const downloadedModels = await this.modelService.getValidDownloadedModels();
      modelPath = downloadedModels[this.preferredModelId]?.localPath ?? null;

      if (!modelPath) {
        logger.transcription.warn(
          "Preferred Whisper model is unavailable; falling back to best available model",
          { preferredModelId: this.preferredModelId },
        );
      }
    }

    if (!modelPath) {
      modelPath = await this.modelService.getBestAvailableModelPath();
    }

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

    this.reset();
  }
}
