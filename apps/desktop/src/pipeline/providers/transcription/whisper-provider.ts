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
import { AppError, ErrorCodes } from "../../../types/error";
import { extractSpeechFromVad } from "../../utils/vad-audio-filter";

export class WhisperProvider implements TranscriptionProvider {
  readonly name = "whisper-local";

  private modelService: ModelService;
  private workerWrapper: SimpleForkWrapper | null = null;

  // Frame aggregation state
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;

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
  private readonly MIN_AUDIO_DURATION_MS = 500; // Minimum buffered audio duration before silence-based transcription
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2; // Threshold for speech detection

  constructor(modelService: ModelService) {
    this.modelService = modelService;
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
      const { aggregatedTranscription, language } = context;

      // Capture speech probabilities before reset
      const vadProbs = [...this.frameBufferSpeechProbabilities];

      // Aggregate buffered frames
      const rawAudio = this.aggregateFrames();

      // Clear buffers immediately after aggregation
      this.reset();

      // Apply VAD filtering to extract speech-only portions
      const { audio: aggregatedAudio, segments: speechSegments } =
        extractSpeechFromVad(rawAudio, vadProbs);

      if (aggregatedAudio.length === 0) {
        logger.transcription.debug(
          "Skipping transcription - no speech detected by VAD filter",
        );
        return "";
      }

      logger.transcription.debug(
        `VAD filtered: ${rawAudio.length} → ${aggregatedAudio.length} samples (${speechSegments.length} speech segments, ${((aggregatedAudio.length / rawAudio.length) * 100).toFixed(0)}% kept)`,
      );

      logger.transcription.debug(
        `Starting transcription of ${aggregatedAudio.length} samples (${((aggregatedAudio.length / this.SAMPLE_RATE) * 1000).toFixed(0)}ms)`,
      );

      if (!this.workerWrapper) {
        throw new AppError(
          "Worker wrapper is not initialized",
          ErrorCodes.WORKER_INITIALIZATION_FAILED,
        );
      }

      // Generate initial prompt from recent context only (align with cloud)
      const initialPrompt = this.generateInitialPrompt(
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
      // Re-throw AppError as-is, wrap other errors
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Whisper transcription failed: ${error instanceof Error ? error.message : error}`,
        ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
      );
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
    // 1. We have enough buffered audio and significant silence after speech
    // 2. Buffer is getting too large

    const audioDurationMs =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;

    // If we have enough buffered audio and then significant silence, transcribe
    if (
      audioDurationMs >= this.MIN_AUDIO_DURATION_MS &&
      silenceDurationMs > this.MAX_SILENCE_DURATION_MS
    ) {
      logger.transcription.debug(
        `Transcribing due to ${silenceDurationMs}ms of silence`,
      );
      return true;
    }

    // If buffer is too large (e.g., 30 seconds), transcribe anyway
    if (audioDurationMs > 30000) {
      logger.transcription.debug(
        `Transcribing due to buffer size: ${audioDurationMs}ms`,
      );
      return true;
    }

    logger.transcription.debug("Not transcribing", {
      audioDurationMs,
      silenceDurationMs,
      frameBufferLength: this.frameBuffer.length,
      silenceFrameCount: this.currentSilenceFrameCount,
    });

    return false;
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

  private generateInitialPrompt(
    aggregatedTranscription?: string,
    accessibilityContext?: TranscribeContext["accessibilityContext"],
  ): string {
    if (aggregatedTranscription) {
      // Pass full transcription - whisper.cpp auto-truncates to last ~224 tokens
      logger.transcription.debug(
        `Generated initial prompt from aggregated transcription: "${aggregatedTranscription}"`,
      );
      return aggregatedTranscription;
    }

    const beforeText =
      accessibilityContext?.context?.textSelection?.preSelectionText;
    if (beforeText && beforeText.trim().length > 0) {
      logger.transcription.debug(
        `Generated initial prompt from before text: "${beforeText}"`,
      );
      return beforeText;
    }

    logger.transcription.debug("Generated initial prompt: empty");
    return "";
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

    const modelPath = await this.modelService.getBestAvailableModelPath();
    if (!modelPath) {
      throw new AppError(
        "No Whisper models available. Please download a model first.",
        ErrorCodes.MODEL_MISSING,
      );
    }

    try {
      await this.workerWrapper.exec("initializeModel", [modelPath]);
    } catch (error) {
      logger.transcription.error(`Failed to initialize:`, error);
      // Re-throw AppError as-is, wrap other errors
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Whisper model initialization failed: ${error instanceof Error ? error.message : error}`,
        ErrorCodes.WORKER_INITIALIZATION_FAILED,
      );
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
