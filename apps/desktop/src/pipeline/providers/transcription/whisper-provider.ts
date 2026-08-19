import type {
  OpenTranscriptionSessionOptions,
  TranscribeContext,
  TranscribeParams,
  TranscriptionEngine,
  TranscriptionOutput,
  TranscriptionProviderSession,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { ModelService } from "../../../services/model-service";
import { SimpleForkWrapper } from "./simple-fork-wrapper";
import * as path from "path";
import { app } from "electron";
import {
  EngineDisposed,
  LocalTranscriptionFailed,
  LocalTranscriptionUnsupported,
  ModelMissing,
  WorkerInitFailed,
  isLocalWhisperError,
} from "../../../types/errors";
import { isLocalTranscriptionSupported } from "../../../utils/os-version";
import { extractSpeechFromVad } from "../../utils/vad-audio-filter";
import { buildWhisperPrompt } from "./whisper-prompt";
import { Mutex } from "async-mutex";

const FRAME_SIZE = 512; // 32ms at 16kHz
const MIN_AUDIO_DURATION_MS = 500;
const MAX_SILENCE_DURATION_MS = 3000;
const SAMPLE_RATE = 16000;
const SPEECH_PROBABILITY_THRESHOLD = 0.2;

type WhisperSessionRuntime = {
  assertAvailable(): void;
  initialize(modelPath: string): Promise<void>;
  transcribeAudio(
    modelPath: string,
    audio: Float32Array,
    context: TranscribeContext,
  ): Promise<TranscriptionOutput>;
};

class WhisperProviderSession implements TranscriptionProviderSession {
  readonly name = "whisper-local";

  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;
  private initializationPromise: Promise<string> | null = null;
  private cancelled = false;

  constructor(
    readonly sessionId: string,
    private readonly modelPath: Promise<string>,
    private readonly runtime: WhisperSessionRuntime,
  ) {}

  /**
   * Process one audio chunk. Buffering belongs to this session; the engine only
   * owns the shared worker and loaded model.
   */
  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    if (this.cancelled) {
      return { text: "" };
    }

    this.runtime.assertAvailable();
    const modelPath = await this.readyModelPath();
    if (!modelPath || this.cancelled) {
      return { text: "" };
    }
    this.runtime.assertAvailable();

    const { audioData, speechProbability = 1, context } = params;
    this.frameBuffer.push(audioData);
    this.frameBufferSpeechProbabilities.push(speechProbability);

    const isSpeech = speechProbability > SPEECH_PROBABILITY_THRESHOLD;

    logger.transcription.debug(
      `Frame received - SpeechProb: ${speechProbability.toFixed(3)}, Buffer size: ${this.frameBuffer.length}, Silence count: ${this.currentSilenceFrameCount}`,
    );

    if (isSpeech) {
      this.currentSilenceFrameCount = 0;
    } else {
      this.currentSilenceFrameCount++;
    }

    if (!this.shouldTranscribe()) {
      return { text: "" };
    }

    return this.doTranscription(context, modelPath);
  }

  /**
   * Flush only this session's buffered audio.
   */
  async flush(
    context: TranscribeContext,
    signal?: AbortSignal,
  ): Promise<TranscriptionOutput> {
    if (this.cancelled || signal?.aborted || this.frameBuffer.length === 0) {
      return { text: "" };
    }

    this.runtime.assertAvailable();
    const modelPath = await this.readyModelPath();
    if (!modelPath || this.cancelled || signal?.aborted) {
      return { text: "" };
    }
    this.runtime.assertAvailable();

    // The native decode cannot be interrupted mid-flight. The caller's
    // post-flush abort gate discards a result if cancellation arrives later.
    return this.doTranscription(context, modelPath);
  }

  /**
   * Cancel this operation without touching another session or the shared model.
   */
  cancel(): void {
    this.cancelled = true;
    this.resetBuffers();
  }

  private ensureInitialized(): Promise<string> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.modelPath.then(async (modelPath) => {
        if (!this.cancelled) {
          await this.runtime.initialize(modelPath);
        }
        return modelPath;
      });
    }
    return this.initializationPromise;
  }

  private async readyModelPath(): Promise<string | null> {
    try {
      return await this.ensureInitialized();
    } catch (error) {
      if (this.cancelled) {
        return null;
      }
      throw error;
    }
  }

  private async doTranscription(
    context: TranscribeContext,
    modelPath: string,
  ): Promise<TranscriptionOutput> {
    try {
      const vadProbs = [...this.frameBufferSpeechProbabilities];
      const rawAudio = this.aggregateFrames();

      // Detach the admitted batch before the native call so later frames, if
      // any, start a fresh buffer.
      this.resetBuffers();

      const { audio: aggregatedAudio, segments: speechSegments } =
        extractSpeechFromVad(rawAudio, vadProbs);

      if (aggregatedAudio.length === 0) {
        logger.transcription.debug(
          "Skipping transcription - no speech detected by VAD filter",
        );
        return { text: "" };
      }

      logger.transcription.debug(
        `VAD filtered: ${rawAudio.length} → ${aggregatedAudio.length} samples (${speechSegments.length} speech segments, ${((aggregatedAudio.length / rawAudio.length) * 100).toFixed(0)}% kept)`,
      );

      logger.transcription.debug(
        `Starting transcription of ${aggregatedAudio.length} samples (${((aggregatedAudio.length / SAMPLE_RATE) * 1000).toFixed(0)}ms)`,
      );

      const result = await this.runtime.transcribeAudio(
        modelPath,
        aggregatedAudio,
        context,
      );
      return this.cancelled ? { text: "" } : result;
    } catch (error) {
      if (this.cancelled) {
        return { text: "" };
      }
      logger.transcription.error("Transcription failed:", error);
      if (isLocalWhisperError(error)) {
        throw error;
      }
      throw new LocalTranscriptionFailed({
        message: `Whisper transcription failed: ${error instanceof Error ? error.message : error}`,
        cause: error,
      });
    }
  }

  private resetBuffers(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
  }

  private shouldTranscribe(): boolean {
    const audioDurationMs =
      ((this.frameBuffer.length * FRAME_SIZE) / SAMPLE_RATE) * 1000;
    const silenceDurationMs =
      ((this.currentSilenceFrameCount * FRAME_SIZE) / SAMPLE_RATE) * 1000;

    if (
      audioDurationMs >= MIN_AUDIO_DURATION_MS &&
      silenceDurationMs > MAX_SILENCE_DURATION_MS
    ) {
      logger.transcription.debug(
        `Transcribing due to ${silenceDurationMs}ms of silence`,
      );
      return true;
    }

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
}

/**
 * Long-lived local transcription engine.
 *
 * The engine owns the reusable worker and loaded model. Each opened session
 * owns its own audio/VAD buffers and cancellation state.
 */
export class WhisperProvider implements TranscriptionEngine {
  readonly name = "whisper-local";

  private readonly resourceMutex = new Mutex();
  private workerWrapper: SimpleForkWrapper | null = null;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;

  constructor(private readonly modelService: ModelService) {}

  openSession(
    options: OpenTranscriptionSessionOptions,
  ): TranscriptionProviderSession {
    this.assertNotDisposed();
    const modelPath = this.resolveModelPath(options.modelId);
    // Resolution starts when the session opens, which pins null/default
    // selection too. The session still observes the rejection on first use.
    void modelPath.catch(() => undefined);

    return new WhisperProviderSession(options.sessionId, modelPath, {
      assertAvailable: () => this.assertNotDisposed(),
      initialize: (path) => this.initializeModel(path),
      transcribeAudio: (path, audio, context) =>
        this.transcribeAudio(path, audio, context),
    });
  }

  /**
   * Preload the model into the engine-owned worker.
   */
  async preloadModel(): Promise<void> {
    await this.initializeWhisper();
  }

  async warmup(): Promise<void> {
    await this.initializeWhisper();
  }

  /**
   * Initialize the currently selected model for warmup/preload callers.
   */
  async initializeWhisper(): Promise<void> {
    this.assertNotDisposed();
    const modelPath = await this.resolveModelPath();
    await this.initializeModel(modelPath);
  }

  private async initializeModel(modelPath: string): Promise<void> {
    await this.resourceMutex.runExclusive(async () => {
      this.assertNotDisposed();
      await this.initializeWhisperResource(modelPath);
    });
  }

  private async initializeWhisperResource(
    modelPath: string,
  ): Promise<SimpleForkWrapper> {
    // On-device transcription requires macOS 15+ (the bundled bindings only
    // load there). Refuse before forking the worker so the native binding is
    // never loaded on an unsupported OS.
    if (!isLocalTranscriptionSupported()) {
      throw new LocalTranscriptionUnsupported({
        message: "Local transcription requires macOS 15 or later.",
      });
    }

    let worker = this.workerWrapper;
    if (!worker) {
      const workerPath = app.isPackaged
        ? path.join(__dirname, "whisper-worker-fork.js")
        : path.join(process.cwd(), ".vite/build/whisper-worker-fork.js");

      logger.transcription.info(
        `Initializing Whisper worker at: ${workerPath}`,
      );

      worker = new SimpleForkWrapper(workerPath, this.getNodeBinaryPath());

      try {
        await worker.initialize();
        this.workerWrapper = worker;
      } catch (error) {
        try {
          await worker.terminate();
        } catch (terminationError) {
          logger.transcription.warn(
            "Failed to terminate Whisper worker after initialization error:",
            terminationError,
          );
        }
        // A fork/spawn failure IS a worker-init failure, on every path that
        // reaches it (session init and the transcribe-time auto-restart) —
        // the tagged pin records both recodes.
        if (isLocalWhisperError(error)) {
          throw error;
        }
        throw new WorkerInitFailed({
          message: `Whisper worker failed to start: ${error instanceof Error ? error.message : error}`,
          cause: error,
        });
      }
    }

    try {
      await worker.exec("initializeModel", [modelPath]);
    } catch (error) {
      if (this.workerWrapper === worker) {
        this.workerWrapper = null;
      }
      try {
        await worker.terminate();
      } catch (terminationError) {
        logger.transcription.warn(
          "Failed to terminate Whisper worker after model initialization error:",
          terminationError,
        );
      }
      logger.transcription.error("Failed to initialize:", error);
      if (isLocalWhisperError(error)) {
        throw error;
      }
      throw new WorkerInitFailed({
        message: `Whisper model initialization failed: ${error instanceof Error ? error.message : error}`,
        cause: error,
      });
    }

    return worker;
  }

  private async transcribeAudio(
    modelPath: string,
    aggregatedAudio: Float32Array,
    context: TranscribeContext,
  ): Promise<TranscriptionOutput> {
    return this.resourceMutex.runExclusive(async () => {
      this.assertNotDisposed();
      const worker = await this.initializeWhisperResource(modelPath);
      const initialPrompt = this.generateInitialPrompt(
        context.vocabulary,
        context.aggregatedTranscription,
        context.accessibilityContext,
      );

      const result = await worker.exec<TranscriptionOutput>("transcribeAudio", [
        aggregatedAudio,
        {
          // One language forces it; multiple drives constrained auto-detection
          // in the addon; empty/undefined means auto-detect.
          languages: context.languages,
          initial_prompt: initialPrompt,
          suppress_blank: true,
          suppress_non_speech_tokens: true,
          no_timestamps: false,
          format: "detail",
        },
      ]);

      logger.transcription.debug(
        `Transcription completed, length: ${result.text.length}`,
      );

      return result;
    });
  }

  private async resolveModelPath(modelId?: string | null): Promise<string> {
    const modelPath = modelId
      ? (await this.modelService.getValidDownloadedModels())[modelId]?.localPath
      : await this.modelService.getBestAvailableModelPath();

    if (!modelPath) {
      throw new ModelMissing({
        message: modelId
          ? `Selected Whisper model is unavailable: ${modelId}`
          : "No Whisper models available. Please download a model first.",
        modelId: modelId ?? undefined,
      });
    }

    return modelPath;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposed({
        message: "Whisper transcription engine has been disposed",
      });
    }
  }

  private generateInitialPrompt(
    vocabulary?: readonly string[],
    aggregatedTranscription?: string,
    accessibilityContext?: TranscribeContext["accessibilityContext"],
  ): string {
    const prompt = buildWhisperPrompt({
      vocabulary,
      previousTranscription: aggregatedTranscription,
      beforeText:
        accessibilityContext?.context?.textSelection?.preSelectionText,
    });

    if (prompt) {
      logger.transcription.debug(`Generated initial prompt: "${prompt}"`);
      return prompt;
    }

    logger.transcription.debug("Generated initial prompt: empty");
    return "";
  }

  private getNodeBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const binaryName = platform === "win32" ? "node.exe" : "node";

    if (app.isPackaged) {
      return path.join(process.resourcesPath, binaryName);
    }

    return path.join(
      __dirname,
      "../../node-binaries",
      `${platform}-${arch}`,
      binaryName,
    );
  }

  dispose(): Promise<void> {
    if (this.disposalPromise) {
      return this.disposalPromise;
    }

    // Terminal from the moment disposal is requested. Queued resource work
    // will observe this after the current operation releases the mutex.
    this.disposed = true;
    this.disposalPromise = this.resourceMutex.runExclusive(async () => {
      const worker = this.workerWrapper;
      this.workerWrapper = null;
      if (!worker) {
        return;
      }

      try {
        await worker.exec("dispose", []);
      } catch (error) {
        logger.transcription.warn("Error disposing Whisper model:", error);
      }

      try {
        await worker.terminate();
        logger.transcription.debug("Worker terminated");
      } catch (error) {
        logger.transcription.warn("Error terminating Whisper worker:", error);
      }
    });

    return this.disposalPromise;
  }
}
