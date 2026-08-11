import {
  TranscribeContext,
  TranscriptionEngine,
} from "../pipeline/core/pipeline-types";
import { WhisperProvider } from "../pipeline/providers/transcription/whisper-provider";
import { AmicalCloudProvider } from "../pipeline/providers/transcription/amical-cloud-provider";
import { ModelService } from "../services/model-service";
import { SettingsService } from "../services/settings-service";
import { TelemetryService } from "../services/telemetry-service";
import type { AuthService } from "./auth-service";
import type { NativeBridge } from "./platform/native-bridge-service";
import type { OnboardingService } from "./onboarding-service";
import { createTranscription } from "../db/transcriptions";
import { incrementDailyStats } from "../db/daily-stats";
import { logger } from "../main/logger";
import { VADService } from "./vad-service";
import { Mutex } from "async-mutex";
import { dialog } from "electron";
import { AVAILABLE_MODELS } from "../constants/models";
import { AppError, ErrorCodes } from "../types/error";
import { isAmicalCloudSelectionValue } from "../utils/model-selection";
import { Effect, Layer } from "effect";
import {
  TranscriptionServiceTag,
  ModelServiceTag,
  VadServiceTag,
  SettingsServiceTag,
  TelemetryServiceTag,
  AuthServiceTag,
  NativeBridgeTag,
  OnboardingServiceTag,
  AppScopeTag,
} from "../main/runtime/tags";
import { addRelease, step, up } from "../main/runtime/layer-helpers";
import { LiveTranscriptionSession } from "./transcription/live-transcription-session";
import type {
  MaterializedTranscriptionSession,
  StreamingSessionUpdate,
} from "./transcription/types";
import { loadDictationContext } from "./transcription/load-dictation-context";
import {
  accumulateTranscriptionResult,
  mergeDetectedLanguage,
  prepareTranscriptText,
  sanitizeDetectedLanguage,
  singleRequestedLanguage,
} from "./transcription/prepare-transcript-text";
import { retranscribeHistoryItem } from "./transcription/retranscribe-history-item";

type StreamingChunkOptions = {
  sessionId: string;
  audioChunk: Float32Array;
  recordingStartedAt?: number;
  isInstruct?: boolean;
};

type FinalizeSessionOptions = {
  sessionId: string;
  audioFilePath?: string;
  recordingStartedAt?: number;
  recordingStoppedAt?: number;
};

/** Prepared transcript + descriptive fields, nothing persisted. */
export type ResolvedStreamingSession = {
  text: string;
  language?: string;
  detectedLanguage?: string;
  speechModel?: string;
  formattingModel?: string;
  audioDurationSeconds?: number;
  meta: {
    source?: string;
    vocabularySize: number;
    formattingStyle?: string;
  };
};

/**
 * Service for audio transcription and optional formatting
 */
export class TranscriptionService {
  private whisperEngine: WhisperProvider;
  private cloudEngine: AmicalCloudProvider;
  private activeLiveSession: LiveTranscriptionSession | null = null;
  private historyRetryInProgress = false;
  private vadService: VADService | null;
  private settingsService: SettingsService;
  private vadMutex: Mutex;
  private transcriptionMutex: Mutex;
  private modelLoadMutex: Mutex;
  private telemetryService: TelemetryService;
  private modelService: ModelService;
  private modelWasPreloaded: boolean = false;
  private loggedVadFallback = false;

  // Construction goes through Live: the graph is the only thing that may
  // build this service, which also makes single-construction structural.
  private constructor(
    modelService: ModelService,
    vadService: VADService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
    authService: AuthService,
    private nativeBridge: NativeBridge | null,
    private onboardingService: OnboardingService | null,
  ) {
    this.whisperEngine = new WhisperProvider(modelService);
    this.cloudEngine = new AmicalCloudProvider(
      authService,
      telemetryService,
      settingsService,
    );
    this.vadService = vadService;
    this.settingsService = settingsService;
    this.vadMutex = new Mutex();
    this.transcriptionMutex = new Mutex();
    this.modelLoadMutex = new Mutex();
    this.telemetryService = telemetryService;
    this.modelService = modelService;
  }

  /**
   * Warm the active provider in advance of a session so first-chunk latency
   * doesn't include model load (whisper) or token refresh (cloud).
   * Idempotent and cheap when already warm. Safe to fire-and-forget.
   */
  async warmupActiveProvider(): Promise<void> {
    const engine = await this.selectEngine();
    await engine.warmup?.();
  }

  beginStreamingSession(
    sessionId: string,
    onTerminalFailure?: (error: Error) => void,
  ): boolean {
    if (this.activeLiveSession) {
      throw new Error("Another live transcription session is already active");
    }

    if (this.historyRetryInProgress) {
      return false;
    }

    const liveSession = new LiveTranscriptionSession(sessionId, (error) => {
      try {
        onTerminalFailure?.(error);
      } catch (callbackError) {
        logger.transcription.error(
          "Failed to handle terminal streaming session failure",
          { sessionId, error: callbackError },
        );
      }
    });
    this.activeLiveSession = liveSession;
    return true;
  }

  /** Latch a renderer-originated failure; the caller owns the FSM transition. */
  latchStreamingSessionFailure(sessionId: string, error: unknown): void {
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== sessionId) {
      return;
    }

    liveSession.latchTerminalFailure(error);
  }

  private buildTranscribeContextForSession(
    sessionId: string,
    session: MaterializedTranscriptionSession,
  ): TranscribeContext {
    const previousChunk =
      session.transcriptionResults.length > 0
        ? session.transcriptionResults[session.transcriptionResults.length - 1]
        : undefined;
    const aggregatedTranscription = session.transcriptionResults.join("");

    return {
      sessionId,
      vocabulary: session.context.vocabulary,
      accessibilityContext: session.context.accessibilityContext,
      previousChunk,
      aggregatedTranscription: aggregatedTranscription || undefined,
      languages: session.context.languages,
      formattingEnabled: session.context.cloudFormattingEnabled,
      isInstruct: session.context.isInstruct,
    };
  }

  async updateStreamingSession(
    options: { sessionId: string } & StreamingSessionUpdate,
  ): Promise<void> {
    const update: StreamingSessionUpdate = {};
    if (options.accessibilityContext !== undefined) {
      update.accessibilityContext = options.accessibilityContext;
    }
    if (options.isInstruct !== undefined) {
      update.isInstruct = options.isInstruct;
    }
    if (
      update.accessibilityContext === undefined &&
      update.isInstruct === undefined
    ) {
      return;
    }

    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== options.sessionId) {
      return;
    }

    const session = liveSession.updateSnapshot(update);
    if (!session?.providerSession.updateSessionContext) {
      return;
    }

    const providerContext = this.buildTranscribeContextForSession(
      options.sessionId,
      session,
    );
    // The in-memory snapshot is immediate. Provider sync is best-effort and
    // must not block audio or finalization; flush sends the latest snapshot.
    void Promise.resolve()
      .then(() => {
        if (!liveSession.canPushContextTo(session)) {
          return;
        }
        return session.providerSession.updateSessionContext?.(providerContext);
      })
      .catch((error) => {
        if (liveSession.canPushContextTo(session)) {
          logger.transcription.warn(
            "Failed to update streaming provider context",
            { sessionId: options.sessionId, error },
          );
        }
      });
  }

  /**
   * Select the appropriate transcription engine based on the selected model.
   */
  private async selectEngine(): Promise<TranscriptionEngine> {
    const selectedModelId = await this.modelService.getSelectedModel();
    return this.engineForSelectedModel(selectedModelId);
  }

  private engineForSelectedModel(
    selectedModelId: string | null,
  ): TranscriptionEngine {
    if (!selectedModelId) {
      // Default to whisper if no model selected
      return this.whisperEngine;
    }

    // Find the model in AVAILABLE_MODELS
    const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);

    // Use cloud provider for Amical Cloud models
    if (model?.provider === "Amical Cloud") {
      return this.cloudEngine;
    }

    // Default to whisper for all other models
    return this.whisperEngine;
  }

  /**
   * The service's layer. Non-fatal by design: a failed init leaves the tag
   * null and boot continues — verbatim from the old container, including the
   * telemetry capture and log lines. The dispose() release registers on the
   * app scope only for the non-null case, so a failed init gets no
   * finalizer, matching the old container. Composed into AppLive by
   * src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<
    TranscriptionServiceTag,
    never,
    | ModelServiceTag
    | VadServiceTag
    | SettingsServiceTag
    | TelemetryServiceTag
    | AuthServiceTag
    | NativeBridgeTag
    | OnboardingServiceTag
    | AppScopeTag
  > = Layer.effect(
    TranscriptionServiceTag,
    Effect.gen(function* () {
      const modelService = yield* ModelServiceTag;
      const vadService = yield* VadServiceTag;
      const settingsService = yield* SettingsServiceTag;
      const telemetryService = yield* TelemetryServiceTag;
      const authService = yield* AuthServiceTag;
      const nativeBridge = yield* NativeBridgeTag;
      const onboardingService = yield* OnboardingServiceTag;
      const appScope = yield* AppScopeTag;
      const service = yield* step(async () => {
        try {
          const transcriptionService = new TranscriptionService(
            modelService,
            vadService,
            settingsService,
            telemetryService,
            authService,
            nativeBridge,
            onboardingService,
          );
          await transcriptionService.initialize();
          logger.transcription.info("Transcription Service initialized", {
            client: "Pipeline with Whisper",
          });
          up("transcriptionService");
          return transcriptionService;
        } catch (error) {
          telemetryService.captureException(error, {
            source: "service_manager",
            stage: "initialize_ai_services",
          });
          logger.transcription.error(
            "Error initializing Transcription Service:",
            error,
          );
          logger.transcription.warn(
            "Transcription will not work until configuration is fixed",
          );
          return null;
        }
      });
      if (service) {
        // dispose() kills the Whisper fork and the cloud engine runtime.
        yield* addRelease(
          appScope,
          "Disposing transcription service...",
          "transcriptionService",
          () => service.dispose(),
        );
      }
      return service;
    }),
  );

  /**
   * Test-only escape hatch: a raw, UNINITIALIZED instance for unit tests
   * that drive internals directly. Production construction goes through
   * Live, the only path that runs initialize().
   */
  static createForTests(
    modelService: ModelService,
    vadService: VADService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
    authService: AuthService,
    nativeBridge: NativeBridge | null,
    onboardingService: OnboardingService | null,
  ): TranscriptionService {
    return new TranscriptionService(
      modelService,
      vadService,
      settingsService,
      telemetryService,
      authService,
      nativeBridge,
      onboardingService,
    );
  }

  private async initialize(): Promise<void> {
    // Check if the selected model is a cloud model
    const selectedModelId = await this.modelService.getSelectedModel();
    const model = selectedModelId
      ? AVAILABLE_MODELS.find((m) => m.id === selectedModelId)
      : null;
    const isCloudModel = model?.provider === "Amical Cloud";

    // Only preload for local models
    if (!isCloudModel) {
      // Check if we should preload Whisper model
      const transcriptionSettings =
        await this.settingsService.getTranscriptionSettings();
      const shouldPreload =
        transcriptionSettings?.preloadWhisperModel !== false; // Default to true

      if (shouldPreload) {
        // Check if models are available for preloading
        const hasModels = await this.isModelAvailable();
        if (hasModels) {
          logger.transcription.info("Preloading Whisper model...");
          await this.preloadWhisperModel();
          this.modelWasPreloaded = true;
          logger.transcription.info("Whisper model preloaded successfully");
        } else {
          logger.transcription.info(
            "Whisper model preloading skipped - no models available",
          );
          setTimeout(async () => {
            const onboardingCheck =
              await this.onboardingService?.checkNeedsOnboarding();
            if (!onboardingCheck?.needed) {
              dialog.showMessageBox({
                type: "warning",
                title: "No Transcription Models",
                message: "No transcription models are available.",
                detail:
                  "To use voice transcription, please download a model from Speech Models or use a cloud model.",
                buttons: ["OK"],
              });
            }
          }, 2000); // Delay to ensure windows are ready
        }
      } else {
        logger.transcription.info("Whisper model preloading disabled");
      }
    } else {
      // Cloud model selected: warm auth so the first dictation's first chunk
      // doesn't block on a token-refresh roundtrip.
      try {
        await this.cloudEngine.warmup?.();
        logger.transcription.info("Cloud auth warmed up");
      } catch (error) {
        logger.transcription.warn("Cloud auth warmup failed (non-fatal)", {
          error,
        });
      }
    }

    logger.transcription.info("Transcription service initialized");
  }

  /**
   * Preload Whisper model into memory
   */
  async preloadWhisperModel(): Promise<void> {
    try {
      // This will trigger the model initialization in WhisperProvider
      await this.whisperEngine.preloadModel();
      logger.transcription.info("Whisper model preloaded successfully");
    } catch (error) {
      logger.transcription.error("Failed to preload Whisper model:", error);
      throw error;
    }
  }

  /**
   * Check if transcription models are available (real-time check)
   */
  public async isModelAvailable(): Promise<boolean> {
    try {
      // Check if selected model is a cloud model (doesn't need download)
      const selectedModelId = await this.modelService.getSelectedModel();
      if (selectedModelId) {
        const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);
        if (model?.provider === "Amical Cloud") {
          return true;
        }
      }

      // For local models, check if any are downloaded
      const modelService = this.whisperEngine["modelService"];
      const availableModels = await modelService.getValidDownloadedModels();
      return Object.keys(availableModels).length > 0;
    } catch (error) {
      logger.transcription.error("Failed to check model availability:", error);
      return false;
    }
  }

  /**
   * Handle model change - load new model if preloading is enabled
   * Uses mutex to serialize concurrent model loads
   */
  async handleModelChange(): Promise<void> {
    this.modelLoadMutex.runExclusive(async () => {
      try {
        this.modelWasPreloaded = false;

        // Check if preloading is enabled and models are available
        if (this.settingsService) {
          const transcriptionSettings =
            await this.settingsService.getTranscriptionSettings();
          const shouldPreload =
            transcriptionSettings?.preloadWhisperModel !== false;

          if (shouldPreload) {
            const hasModels = await this.isModelAvailable();
            if (hasModels) {
              logger.transcription.info(
                "Loading Whisper model after model change...",
              );
              await this.whisperEngine.preloadModel();
              this.modelWasPreloaded = true;
              logger.transcription.info("Whisper model loaded successfully");
            } else {
              logger.transcription.info("No models available to preload");
            }
          }
        }
      } catch (error) {
        logger.transcription.error("Failed to handle model change:", error);
        // Don't throw - model will be loaded on first use
      }
    });
  }

  /**
   * Process a single audio chunk in streaming mode
   * For finalization, use finalizeSession() instead
   */
  async processStreamingChunk(options: StreamingChunkOptions): Promise<string> {
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== options.sessionId) {
      logger.transcription.debug(
        "Ignoring chunk for inactive streaming session",
        { sessionId: options.sessionId },
      );
      return "";
    }

    if (options.isInstruct !== undefined) {
      liveSession.updateSnapshot({ isInstruct: options.isInstruct });
    }

    return liveSession.processChunk(() =>
      this.processAdmittedStreamingChunk(liveSession, options),
    );
  }

  private async processAdmittedStreamingChunk(
    liveSession: LiveTranscriptionSession,
    options: StreamingChunkOptions,
  ): Promise<string> {
    const { sessionId, audioChunk, recordingStartedAt } = options;

    // Run VAD on the audio chunk
    let speechProbability = this.vadService ? 0 : 1;
    let isSpeaking = !this.vadService && audioChunk.length > 0;

    if (audioChunk.length > 0 && !this.vadService && !this.loggedVadFallback) {
      logger.transcription.warn(
        "VAD unavailable; defaulting speechProbability to 1.0 for streaming chunks",
      );
      this.loggedVadFallback = true;
    }

    if (audioChunk.length > 0 && this.vadService) {
      // Acquire VAD mutex
      await this.vadMutex.acquire();
      try {
        if (!liveSession.canCompleteAdmittedWork()) {
          return "";
        }
        // Pass Float32Array directly to VAD
        const vadResult = await this.vadService.processAudioFrame(audioChunk);

        speechProbability = vadResult.probability;
        isSpeaking = vadResult.isSpeaking;
      } finally {
        // Release VAD mutex - always release even on error
        this.vadMutex.release();
      }

      logger.transcription.debug("VAD result", {
        probability: speechProbability.toFixed(3),
        isSpeaking,
      });
    }

    if (!liveSession.canCompleteAdmittedWork()) {
      return "";
    }

    // Acquire transcription mutex
    await this.transcriptionMutex.acquire();
    try {
      if (!liveSession.canCompleteAdmittedWork()) {
        return "";
      }

      let session = liveSession.materializedSession;
      if (!session) {
        const context = await loadDictationContext({
          settingsService: this.settingsService,
          sessionId,
        });
        if (!liveSession.canCompleteAdmittedWork()) {
          return "";
        }
        const formatterConfig = await this.settingsService.getFormatterConfig();
        if (!liveSession.canCompleteAdmittedWork()) {
          return "";
        }
        context.cloudFormattingEnabled = !!(
          formatterConfig?.enabled &&
          isAmicalCloudSelectionValue(formatterConfig.modelId)
        );

        // Get accessibility context from NativeBridge
        context.accessibilityContext =
          this.nativeBridge?.getAccessibilityContext() ?? null;

        const selectedModelId = await this.modelService.getSelectedModel();
        if (!liveSession.canCompleteAdmittedWork()) {
          return "";
        }
        const engine = this.engineForSelectedModel(selectedModelId);
        const providerSession = engine.openSession({
          sessionId,
          modelId: selectedModelId,
          onTerminalFailure: (error) =>
            liveSession.reportTerminalFailure(error),
        });

        session = {
          context,
          providerSession,
          speechModelId:
            providerSession.name === "amical-cloud"
              ? "amical-cloud"
              : selectedModelId || "whisper-local",
          transcriptionResults: [],
          firstChunkReceivedAt: performance.now(),
          recordingStartedAt: recordingStartedAt,
        };

        if (!liveSession.attach(session)) {
          return "";
        }

        logger.transcription.info("Started streaming session", {
          sessionId,
        });
      }
      // Transcribe chunk (flush is done separately in finalizeSession)
      const chunkResult = await session.providerSession.transcribe({
        audioData: audioChunk,
        speechProbability: speechProbability,
        context: this.buildTranscribeContextForSession(sessionId, session),
      });
      if (!liveSession.canCompleteAdmittedWork()) {
        return "";
      }
      session.detectedLanguage = mergeDetectedLanguage(
        session.detectedLanguage,
        chunkResult.detectedLanguage,
      );

      // Accumulate the result only if Whisper returned something
      // (it returns empty string while buffering)
      accumulateTranscriptionResult(
        session.transcriptionResults,
        chunkResult.text,
        session.providerSession.name === "amical-cloud",
      );
      if (chunkResult.text.trim()) {
        logger.transcription.info("Whisper returned transcription", {
          sessionId,
          transcriptionLength: chunkResult.text.length,
          totalResults: session.transcriptionResults.length,
        });
      }

      logger.transcription.debug("Processed frame", {
        sessionId,
        frameSize: audioChunk.length,
        hadTranscription: chunkResult.text.length > 0,
      });
      return session.transcriptionResults.join("");
    } finally {
      // Release transcription mutex - always release even on error
      this.transcriptionMutex.release();
    }
  }

  /**
   * Cancel a streaming session without processing
   * Used when recording is cancelled (e.g., quick tap, accidental activation)
   */
  async cancelStreamingSession(sessionId: string): Promise<void> {
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== sessionId) {
      return;
    }

    liveSession.requestAbort();
    this.retireLiveSession(liveSession);
    logger.transcription.info("Streaming session cancelled", { sessionId });
  }

  /**
   * Dismiss a session by aborting its signal and cancelling its provider
   * session. The signal drives finalizeSession's cooperative gates, while cancel
   * interrupts gRPC/HTTP work immediately. Local Whisper decode is not
   * interruptible, so its result is discarded at the next lifecycle check.
   * No-op if the session is already gone.
   */
  abortSession(sessionId: string): void {
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== sessionId) {
      return;
    }
    liveSession.requestAbort();
    logger.transcription.info("Aborted session", { sessionId });
  }

  private retireLiveSession(liveSession: LiveTranscriptionSession): void {
    liveSession.retire();
    if (this.activeLiveSession === liveSession) {
      this.activeLiveSession = null;
    }
  }

  /**
   * The control signal finalizeSession throws on dismiss. A fresh instance per
   * throw so the stack trace points at the actual throw site.
   */
  private userDismissedError(): AppError {
    return new AppError("Recording dismissed", ErrorCodes.USER_DISMISSED);
  }

  /**
   * Persist a dismissed dictation: empty text, the captured audio (if any), and
   * meta.status="dismissed". No stats increment (the user deliberately discarded).
   */
  async saveDismissedTranscription(options: {
    sessionId: string;
    audioFilePath?: string;
  }): Promise<void> {
    await createTranscription({
      text: "",
      audioFile: options.audioFilePath,
      meta: {
        sessionId: options.sessionId,
        status: "dismissed",
      },
    });
    logger.transcription.info("Saved dismissed transcription record", {
      sessionId: options.sessionId,
      audioFilePath: options.audioFilePath,
    });
  }

  private async saveFailedTranscription(options: {
    sessionId: string;
    audioFilePath?: string;
    error: unknown;
    session?: MaterializedTranscriptionSession;
  }): Promise<void> {
    const { sessionId, audioFilePath, error, session } = options;
    const errorCode =
      error instanceof AppError ? error.errorCode : ErrorCodes.UNKNOWN;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await createTranscription({
      text: "",
      audioFile: audioFilePath,
      language: session
        ? singleRequestedLanguage(session.context.languages)
        : undefined,
      detectedLanguage: session
        ? sanitizeDetectedLanguage(session.detectedLanguage)
        : undefined,
      meta: {
        sessionId,
        status: "failed",
        failureReason: errorCode,
        errorMessage,
      },
    });
    logger.transcription.info("Saved failed transcription record", {
      sessionId,
      errorCode,
      audioFilePath,
    });

    try {
      // Failed rows still appear in History, so they intentionally contribute
      // to totalTranscriptions even though they add zero dictated words.
      await incrementDailyStats(0);
    } catch (statsError) {
      logger.transcription.error("Failed to increment failed dictation stats", {
        sessionId,
        error: statsError,
      });
    }
  }

  /**
   * Finalize a streaming session - flush the provider session, format, save to DB
   * Call this instead of processStreamingChunk with isFinal=true
   */
  /**
   * v2 lifecycle resolve: drain admitted chunks, flush the provider, prepare
   * the transcript, and RETURN it — persistence belongs to the lifecycle's
   * storage commit, and dismissal never flows through here (the lifecycle
   * seals first and cancels this work; an abort surfaces as a throw the
   * caller drops). Returns null when nothing was ever fed.
   */
  async resolveStreamingSession(options: {
    sessionId: string;
    recordingStartedAt?: number;
    recordingStoppedAt?: number;
  }): Promise<ResolvedStreamingSession | null> {
    const { sessionId } = options;
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== sessionId) {
      logger.transcription.warn("No session found to resolve", { sessionId });
      return null;
    }

    liveSession.closeChunkAdmission();
    try {
      await liveSession.drainAdmittedChunks();
      const session = liveSession.materializedSession;
      if (!session) {
        liveSession.throwIfTerminalFailure();
        return null;
      }

      liveSession.throwIfTerminalFailure();
      session.finalizationStartedAt = performance.now();
      session.recordingStoppedAt = options.recordingStoppedAt;
      if (options.recordingStartedAt && !session.recordingStartedAt) {
        session.recordingStartedAt = options.recordingStartedAt;
      }

      const formatterConfig = await this.settingsService.getFormatterConfig();
      const shouldUseCloudFormatting =
        formatterConfig?.enabled &&
        isAmicalCloudSelectionValue(formatterConfig.modelId);
      const usedCloudProvider = session.providerSession.name === "amical-cloud";

      await this.transcriptionMutex.acquire();
      try {
        liveSession.throwIfTerminalFailure();
        const finalResult = await session.providerSession.flush(
          {
            ...this.buildTranscribeContextForSession(sessionId, session),
            formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
          },
          liveSession.signal,
        );
        liveSession.throwIfTerminalFailure();
        session.detectedLanguage = mergeDetectedLanguage(
          session.detectedLanguage,
          finalResult.detectedLanguage,
        );
        accumulateTranscriptionResult(
          session.transcriptionResults,
          finalResult.text,
          usedCloudProvider,
        );
      } finally {
        this.transcriptionMutex.release();
      }

      const rawTranscription = session.transcriptionResults.join("");
      const prepared = await prepareTranscriptText(
        {
          text: rawTranscription,
          usedCloudProvider,
          context: session.context,
          detectedLanguage: session.detectedLanguage,
        },
        {
          settingsService: this.settingsService,
          modelService: this.modelService,
        },
      );
      liveSession.throwIfTerminalFailure();

      const completionTime = performance.now();
      const recordingDuration =
        session.recordingStartedAt && session.recordingStoppedAt
          ? session.recordingStoppedAt - session.recordingStartedAt
          : undefined;
      const processingDuration = session.recordingStoppedAt
        ? completionTime - session.recordingStoppedAt
        : undefined;
      const totalDuration = session.recordingStartedAt
        ? completionTime - session.recordingStartedAt
        : undefined;
      const audioDurationSeconds = session.context.audio.duration;

      let whisperNativeBinding: string | undefined;
      if (this.whisperEngine && "getBindingInfo" in this.whisperEngine) {
        const bindingInfo = await this.whisperEngine.getBindingInfo();
        whisperNativeBinding = bindingInfo?.type;
      }

      this.telemetryService.trackTranscriptionCompleted({
        session_id: sessionId,
        model_id: session.speechModelId,
        model_preloaded: this.modelWasPreloaded,
        whisper_native_binding: whisperNativeBinding,
        total_duration_ms: totalDuration || 0,
        recording_duration_ms: recordingDuration,
        processing_duration_ms: processingDuration,
        audio_duration_seconds: audioDurationSeconds,
        realtime_factor:
          audioDurationSeconds && totalDuration
            ? audioDurationSeconds / (totalDuration / 1000)
            : undefined,
        text_length: prepared.text.length,
        word_count: prepared.wordCount,
        formatting_enabled: prepared.formattingUsed,
        formatting_model: prepared.formattingModel,
        formatting_duration_ms: prepared.formattingDuration,
        vad_enabled: !!this.vadService,
        languages: session.context.languages ?? [],
        vocabulary_size: session.context.vocabulary.length,
      });

      logger.transcription.info("Streaming session resolved", { sessionId });
      return {
        text: prepared.text,
        language: prepared.language,
        detectedLanguage: prepared.detectedLanguage,
        speechModel: session.speechModelId,
        formattingModel: prepared.formattingModel,
        audioDurationSeconds,
        meta: {
          source: session.context.audio.source,
          vocabularySize: session.context.vocabulary.length,
          formattingStyle: session.context.formattingStyle,
        },
      };
    } finally {
      this.retireLiveSession(liveSession);
    }
  }

  /** v1 finalize path — deleted at the lifecycle cutover. */
  async finalizeSession(options: FinalizeSessionOptions): Promise<string> {
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== options.sessionId) {
      logger.transcription.warn("No session found to finalize", {
        sessionId: options.sessionId,
      });
      return "";
    }

    // Closing admission is synchronous: every chunk accepted before this call
    // is now visible to the drain, and later chunks are rejected.
    liveSession.closeChunkAdmission();
    return this.finalizeLiveSession(liveSession, options);
  }

  private async finalizeLiveSession(
    liveSession: LiveTranscriptionSession,
    options: FinalizeSessionOptions,
  ): Promise<string> {
    const { sessionId, audioFilePath, recordingStartedAt, recordingStoppedAt } =
      options;

    await liveSession.drainAdmittedChunks();
    const session = liveSession.materializedSession;
    if (!session) {
      try {
        if (liveSession.signal.aborted) {
          await this.saveDismissedTranscription({
            sessionId,
            audioFilePath: audioFilePath || undefined,
          });
          throw this.userDismissedError();
        }

        try {
          liveSession.throwIfTerminalFailure();
        } catch (error) {
          await this.saveFailedTranscription({
            sessionId,
            audioFilePath: audioFilePath || undefined,
            error,
          });
          throw error;
        }

        logger.transcription.warn("No materialized session to finalize", {
          sessionId,
        });
        return "";
      } finally {
        this.retireLiveSession(liveSession);
      }
    }
    const { signal } = liveSession;

    try {
      // Early dismiss: the user dismissed before the flush started — skip the
      // flush entirely (no wasted transcription call). The catch below persists
      // the dismissed row once and rethrows USER_DISMISSED.
      if (signal.aborted) {
        throw this.userDismissedError();
      }
      liveSession.throwIfTerminalFailure();

      // Update session timestamps
      session.finalizationStartedAt = performance.now();
      session.recordingStoppedAt = recordingStoppedAt;
      if (recordingStartedAt && !session.recordingStartedAt) {
        session.recordingStartedAt = recordingStartedAt;
      }

      const formatterConfig = await this.settingsService.getFormatterConfig();
      const shouldUseCloudFormatting =
        formatterConfig?.enabled &&
        isAmicalCloudSelectionValue(formatterConfig.modelId);
      const usedCloudProvider = session.providerSession.name === "amical-cloud";

      // Flush the provider session to get any remaining buffered audio
      await this.transcriptionMutex.acquire();
      try {
        liveSession.throwIfTerminalFailure();
        const finalResult = await session.providerSession.flush(
          {
            ...this.buildTranscribeContextForSession(sessionId, session),
            formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
          },
          signal,
        );
        liveSession.throwIfTerminalFailure();
        session.detectedLanguage = mergeDetectedLanguage(
          session.detectedLanguage,
          finalResult.detectedLanguage,
        );

        accumulateTranscriptionResult(
          session.transcriptionResults,
          finalResult.text,
          usedCloudProvider,
        );
        if (finalResult.text.trim()) {
          logger.transcription.info("Whisper returned final transcription", {
            sessionId,
            transcriptionLength: finalResult.text.length,
            totalResults: session.transcriptionResults.length,
          });
        }
      } finally {
        this.transcriptionMutex.release();
      }

      const rawTranscription = session.transcriptionResults.join("");

      logger.transcription.info("Finalizing streaming session", {
        sessionId,
        rawTranscriptionLength: rawTranscription.length,
        chunkCount: session.transcriptionResults.length,
      });

      // Finalize-phase dismiss: the flush already ran, but the user dismissed.
      // Discard the transcript — the catch below persists the dismissed row and
      // rethrows USER_DISMISSED (skip paste/stats).
      if (signal.aborted) {
        throw this.userDismissedError();
      }

      const prepared = await prepareTranscriptText(
        {
          text: rawTranscription,
          usedCloudProvider,
          context: session.context,
          detectedLanguage: session.detectedLanguage,
        },
        {
          settingsService: this.settingsService,
          modelService: this.modelService,
        },
      );
      const completeTranscription = prepared.text;

      // Save directly to database
      logger.transcription.info("Saving transcription with audio file", {
        sessionId,
        audioFilePath,
        hasAudioFile: !!audioFilePath,
      });

      // Late dismiss: the user dismissed while formatting was in flight (after
      // the post-flush check). Discard the now-formatted transcript
      // — the catch persists the dismissed row and rethrows USER_DISMISSED, so
      // there's no paste, no stats, no completion telemetry.
      //
      // This is the final gate for selecting the persisted outcome. A dismiss
      // after this point cannot rewrite the successful row. RecordingManager
      // separately checks delivery authority before dispatching native paste.
      if (signal.aborted) {
        throw this.userDismissedError();
      }
      liveSession.throwIfTerminalFailure();

      await createTranscription({
        text: completeTranscription,
        language: prepared.language,
        detectedLanguage: prepared.detectedLanguage,
        duration: session.context.audio.duration,
        speechModel: session.speechModelId,
        formattingModel: prepared.formattingModel,
        audioFile: audioFilePath,
        meta: {
          sessionId,
          source: session.context.audio.source,
          vocabularySize: session.context.vocabulary.length,
          formattingStyle: session.context.formattingStyle,
        },
      });

      try {
        await incrementDailyStats(prepared.wordCount);
      } catch (error) {
        logger.transcription.error("Failed to increment dictation stats", {
          sessionId,
          error,
        });
      }

      // Track transcription completion
      const completionTime = performance.now();

      // Calculate durations:
      // - Recording duration: from when recording started to when it ended
      // - Processing duration: from when recording ended to completion
      // - Total duration: from recording start to completion
      const recordingDuration =
        session.recordingStartedAt && session.recordingStoppedAt
          ? session.recordingStoppedAt - session.recordingStartedAt
          : undefined;
      const processingDuration = session.recordingStoppedAt
        ? completionTime - session.recordingStoppedAt
        : undefined;
      const totalDuration = session.recordingStartedAt
        ? completionTime - session.recordingStartedAt
        : undefined;

      const audioDurationSeconds = session.context.audio.duration;

      // Get native binding info if using local whisper
      let whisperNativeBinding: string | undefined;
      if (this.whisperEngine && "getBindingInfo" in this.whisperEngine) {
        const bindingInfo = await this.whisperEngine.getBindingInfo();
        whisperNativeBinding = bindingInfo?.type;
        logger.transcription.info(
          "whisper native binding used",
          whisperNativeBinding,
        );
      }

      this.telemetryService.trackTranscriptionCompleted({
        session_id: sessionId,
        model_id: session.speechModelId,
        model_preloaded: this.modelWasPreloaded,
        whisper_native_binding: whisperNativeBinding,
        total_duration_ms: totalDuration || 0,
        recording_duration_ms: recordingDuration,
        processing_duration_ms: processingDuration,
        audio_duration_seconds: audioDurationSeconds,
        realtime_factor:
          audioDurationSeconds && totalDuration
            ? audioDurationSeconds / (totalDuration / 1000)
            : undefined,
        text_length: completeTranscription.length,
        word_count: prepared.wordCount,
        formatting_enabled: prepared.formattingUsed,
        formatting_model: prepared.formattingModel,
        formatting_duration_ms: prepared.formattingDuration,
        vad_enabled: !!this.vadService,
        languages: session.context.languages ?? [],
        vocabulary_size: session.context.vocabulary.length,
      });

      logger.transcription.info("Streaming session completed", { sessionId });
      return completeTranscription;
    } catch (error) {
      // Dismiss — either an aborted flush, or the USER_DISMISSED rethrown from
      // the pre/post-flush checks above. Persist the dismissed row once (with the
      // already-written audio) and rethrow USER_DISMISSED so the caller resets
      // silently — no failure toast.
      if (signal.aborted) {
        await this.saveDismissedTranscription({
          sessionId,
          audioFilePath: audioFilePath || undefined,
        });
        logger.transcription.info("Dismissed transcription during finalize", {
          sessionId,
        });
        throw this.userDismissedError();
      }

      await this.saveFailedTranscription({
        sessionId,
        audioFilePath: audioFilePath || undefined,
        error,
        session,
      });

      // Re-throw for RecordingManager to handle notifications
      throw error;
    } finally {
      this.retireLiveSession(liveSession);
    }
  }

  async retryTranscription(transcriptionId: number): Promise<string> {
    if (this.activeLiveSession) {
      throw new Error("Cannot retry while recording is in progress");
    }
    if (this.historyRetryInProgress) {
      throw new Error("Another transcription retry is already in progress");
    }

    this.historyRetryInProgress = true;
    try {
      return await retranscribeHistoryItem(transcriptionId, {
        settingsService: this.settingsService,
        modelService: this.modelService,
        telemetryService: this.telemetryService,
        processVadFrames: (frames) => this.processHistoryVadFrames(frames),
        engineForSelectedModel: (selectedModelId) =>
          this.engineForSelectedModel(selectedModelId),
        withTranscriptionLock: (work) =>
          this.transcriptionMutex.runExclusive(work),
        wasModelPreloaded: () => this.modelWasPreloaded,
        isVadEnabled: () => this.vadService !== null,
      });
    } finally {
      this.historyRetryInProgress = false;
    }
  }

  private async processHistoryVadFrames(
    frames: Float32Array[],
  ): Promise<number[]> {
    if (!this.vadService) {
      return new Array(frames.length).fill(1);
    }

    return this.vadMutex.runExclusive(async () => {
      this.vadService!.reset();
      const probabilities: number[] = [];
      for (const frame of frames) {
        const result = await this.vadService!.processAudioFrame(frame);
        probabilities.push(result.probability);
      }
      return probabilities;
    });
  }

  /**
   * Reset VAD state behind vadMutex so it cannot interleave with retry VAD computation.
   */
  async resetVadForNewSession(): Promise<void> {
    await this.vadMutex.runExclusive(() => {
      this.vadService?.reset();
    });
  }

  /**
   * Cleanup method
   */
  async dispose(): Promise<void> {
    const liveSession = this.activeLiveSession;
    if (liveSession) {
      liveSession.requestAbort();
      this.retireLiveSession(liveSession);
    }
    await this.whisperEngine.dispose();
    await this.cloudEngine.dispose();
    // VAD service is managed by ServiceManager
    logger.transcription.info("Transcription service disposed");
  }
}
