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
import { logger } from "../main/logger";
import { VADService } from "./vad-service";
import { Mutex } from "async-mutex";
import { dialog } from "electron";
import { AVAILABLE_MODELS } from "../constants/models";
import { isAmicalCloudSelectionValue } from "../utils/model-selection";
import { Cause, Effect, Exit, Layer } from "effect";
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
} from "./transcription/prepare-transcript-text";
import { retranscribeHistoryItem } from "./transcription/retranscribe-history-item";
import { settleExit } from "./transcription/effect-boundary";
import { runPromiseExit } from "../main/runtime/telemetry-runtime";
import {
  codeOf,
  failOrDie,
  isDictationError,
  tagOf,
  toDependencyFailure,
  type DictationError,
} from "../types/errors";
import {
  recordChunkAggregate,
  recordDefect,
  recordPoint,
  type ChunkAggregate,
} from "../main/telemetry/dictation-trace";
import {
  makeTokenLock,
  withLock,
  withLockPromise,
  type TokenLock,
} from "./transcription/token-lock";

type StreamingChunkOptions = {
  sessionId: string;
  audioChunk: Float32Array;
  isInstruct?: boolean;
};

/** Prepared transcript + descriptive fields, nothing persisted. */
export type ResolvedStreamingSession = {
  text: string;
  language?: string;
  detectedLanguage?: string;
  speechModel?: string;
  formattingModel?: string;
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
  private vadLock: TokenLock;
  private transcriptionLock: TokenLock;
  private modelLoadMutex: Mutex;
  private chunkStats = new Map<string, ChunkAggregate>();
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
    this.vadLock = makeTokenLock();
    this.transcriptionLock = makeTokenLock();
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

    const liveSession = new LiveTranscriptionSession(
      sessionId,
      (error) => {
        // Latch ACCEPTANCE is the once-authority for out-of-band defects:
        // this callback fires only when the latch took the value, so an
        // unknown value captures here exactly once (classification-latched
        // defects arrive already marked). Losing channels never capture.
        if (!isDictationError(error) && !liveSession.wasDefectReported(error)) {
          liveSession.markDefectsReported([error]);
          this.reportDefects(sessionId, [error]);
        }
        // A stream that reports a terminal result retires itself (§6.1):
        // the registration must be gone before the lifecycle reacts, or the
        // next session's begin finds a dead stream still holding the slot.
        this.retireLiveSession(liveSession);
        recordPoint(sessionId, "transcription.terminal-latch", {
          // The latch fires from chunk classification AND from the provider's
          // out-of-band stream observer, so the stage names the stream, not
          // one phase.
          stage: "transcription.stream",
          errorCode: codeOf(error),
          errorTag: tagOf(error),
        });
        try {
          onTerminalFailure?.(error);
        } catch (callbackError) {
          logger.transcription.error(
            "Failed to handle terminal streaming session failure",
            { sessionId, error: callbackError },
          );
        }
      },
      (defects) => this.reportDefects(sessionId, defects),
    );
    this.activeLiveSession = liveSession;
    this.chunkStats.set(sessionId, {
      modelId: null,
      provider: null,
      count: 0,
      vadMsSum: 0,
      vadMsMax: 0,
      transcribeMsSum: 0,
      transcribeMsMax: 0,
      materializeMs: 0,
      firstChunkAt: null,
      lastChunkAt: null,
    });
    return true;
  }

  /** Live recording admission gate: history retry holds the engines. */
  isHistoryRetryInProgress(): boolean {
    return this.historyRetryInProgress;
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
        // The push may outlive cancellation/finalization, so an unknown
        // rejection captures REGARDLESS of session phase — exactly once;
        // the typed-failure log stays best-effort-gated as before.
        if (!isDictationError(error)) {
          if (!liveSession.wasDefectReported(error)) {
            liveSession.markDefectsReported([error]);
            this.reportDefects(options.sessionId, [error]);
          }
          return;
        }
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

    const stats = this.chunkStats.get(options.sessionId);
    if (stats) {
      const now = Date.now();
      stats.count += 1;
      stats.firstChunkAt ??= now;
      stats.lastChunkAt = now;
    }
    return liveSession.processChunkEffect(
      this.chunkEffect(liveSession, options),
    );
  }

  /**
   * One admitted chunk as an Effect: the VAD region and the transcription
   * region each run uninterruptible inside their lock, so interruption lands
   * only at the region boundaries — the same points where the cooperative
   * guards sit. The guards themselves stay: a latched terminal failure fences
   * work without interruption. Failures carry the original error object
   * through the typed channel; the session ledger classifies them.
   */
  private chunkEffect(
    liveSession: LiveTranscriptionSession,
    options: StreamingChunkOptions,
  ): Effect.Effect<string, DictationError> {
    const { sessionId, audioChunk } = options;
    const service = this;

    return Effect.gen(function* () {
      // Run VAD on the audio chunk
      let speechProbability = service.vadService ? 0 : 1;
      let isSpeaking = !service.vadService && audioChunk.length > 0;

      if (
        audioChunk.length > 0 &&
        !service.vadService &&
        !service.loggedVadFallback
      ) {
        logger.transcription.warn(
          "VAD unavailable; defaulting speechProbability to 1.0 for streaming chunks",
        );
        service.loggedVadFallback = true;
      }

      if (audioChunk.length > 0 && service.vadService) {
        const vadStartedAt = performance.now();
        const vadOutcome = yield* withLock(
          service.vadLock,
          Effect.uninterruptible(
            Effect.suspend(() => {
              if (!liveSession.canCompleteAdmittedWork()) {
                return Effect.succeed(null);
              }
              // Pass Float32Array directly to VAD. The field projection
              // stays INSIDE the try thunk: outside it, a malformed VAD
              // result would throw as a defect that the degrade arm below
              // cannot catch, and one bad frame would kill the session instead
              // of degrading to assumed speech.
              return Effect.tryPromise({
                try: async () => {
                  const vadResult =
                    await service.vadService!.processAudioFrame(audioChunk);
                  return {
                    probability: vadResult.probability,
                    isSpeaking: vadResult.isSpeaking,
                  };
                },
                catch: (error) => error,
              }).pipe(
                Effect.catchAll((error) => {
                  // A VAD error degrades this chunk exactly like a missing
                  // VAD degrades the whole session: assume speech instead of
                  // letting one bad frame fail the session terminally.
                  logger.transcription.warn(
                    "VAD failed for streaming chunk; assuming speech",
                    { error },
                  );
                  return Effect.succeed({
                    probability: 1,
                    isSpeaking: true,
                  });
                }),
              );
            }),
          ),
        );
        {
          const stats = service.chunkStats.get(sessionId);
          if (stats) {
            const vadMs = performance.now() - vadStartedAt;
            stats.vadMsSum += vadMs;
            stats.vadMsMax = Math.max(stats.vadMsMax, vadMs);
          }
        }
        if (vadOutcome === null) {
          return "";
        }
        speechProbability = vadOutcome.probability;
        isSpeaking = vadOutcome.isSpeaking;

        logger.transcription.debug("VAD result", {
          probability: speechProbability.toFixed(3),
          isSpeaking,
        });
      }

      if (!liveSession.canCompleteAdmittedWork()) {
        return "";
      }

      return yield* withLock(
        service.transcriptionLock,
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (!liveSession.canCompleteAdmittedWork()) {
              return "";
            }

            let session = liveSession.materializedSession;
            if (!session) {
              const materializeStartedAt = performance.now();
              const context = yield* Effect.tryPromise({
                try: () =>
                  loadDictationContext({
                    settingsService: service.settingsService,
                    sessionId,
                  }),
                catch: toDependencyFailure,
              });
              if (!liveSession.canCompleteAdmittedWork()) {
                return "";
              }
              const formatterConfig = yield* Effect.tryPromise({
                try: () => service.settingsService.getFormatterConfig(),
                catch: toDependencyFailure,
              });
              if (!liveSession.canCompleteAdmittedWork()) {
                return "";
              }
              context.cloudFormattingEnabled = !!(
                formatterConfig?.enabled &&
                isAmicalCloudSelectionValue(formatterConfig.modelId)
              );

              // Get accessibility context from NativeBridge
              context.accessibilityContext =
                service.nativeBridge?.getAccessibilityContext() ?? null;

              const selectedModelId = yield* Effect.tryPromise({
                try: () => service.modelService.getSelectedModel(),
                catch: toDependencyFailure,
              });
              if (!liveSession.canCompleteAdmittedWork()) {
                return "";
              }
              const engine = service.engineForSelectedModel(selectedModelId);
              // A sync throw inside gen is a defect whatever class it is, so
              // disposed variants must enter the failure channel through a
              // lift.
              const providerSession = yield* Effect.try({
                try: () =>
                  engine.openSession({
                    sessionId,
                    modelId: selectedModelId,
                    onTerminalFailure: (error) =>
                      liveSession.reportTerminalFailure(error),
                  }),
                catch: (error) => error,
              }).pipe(Effect.catchAll(failOrDie));

              session = {
                context,
                providerSession,
                speechModelId:
                  providerSession.name === "amical-cloud"
                    ? "amical-cloud"
                    : selectedModelId || "whisper-local",
                transcriptionResults: [],
                firstChunkReceivedAt: performance.now(),
              };

              if (!liveSession.attach(session)) {
                return "";
              }

              logger.transcription.info("Started streaming session", {
                sessionId,
              });
              const stats = service.chunkStats.get(sessionId);
              if (stats) {
                stats.materializeMs = performance.now() - materializeStartedAt;
                stats.modelId = session.speechModelId;
                stats.provider = session.providerSession.name;
              }
            }
            // Transcribe chunk (flush is done separately in finalizeSession)
            const transcribeStartedAt = performance.now();
            const chunkResult = yield* Effect.tryPromise({
              try: () =>
                session.providerSession.transcribe({
                  audioData: audioChunk,
                  speechProbability: speechProbability,
                  context: service.buildTranscribeContextForSession(
                    sessionId,
                    session,
                  ),
                }),
              catch: (error) => error,
            }).pipe(Effect.catchAll(failOrDie));
            {
              const stats = service.chunkStats.get(sessionId);
              if (stats) {
                const transcribeMs = performance.now() - transcribeStartedAt;
                stats.transcribeMsSum += transcribeMs;
                stats.transcribeMsMax = Math.max(
                  stats.transcribeMsMax,
                  transcribeMs,
                );
              }
            }
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
          }),
        ),
      );
    });
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
   * The one defect-reporting sink for this service's capture points (chunk
   * classification, resolve triage, the late context push). Typed failures
   * never come here; the latch/marking bookkeeping keeps each defect to one
   * capture.
   */
  private reportDefects(
    sessionId: string,
    defects: ReadonlyArray<unknown>,
  ): void {
    for (const defect of defects) {
      logger.transcription.error("Dictation defect", { sessionId, defect });
      this.telemetryService.captureException(defect, {
        source: "dictation",
        session_id: sessionId,
      });
    }
    if (defects.length > 0) {
      recordDefect(sessionId);
    }
  }

  private retireLiveSession(liveSession: LiveTranscriptionSession): void {
    liveSession.retire();
    const stats = this.chunkStats.get(liveSession.id);
    if (stats) {
      // Emit once and delete: late uninterruptible chunk tails find no
      // entry and their timing is dropped with their results.
      this.chunkStats.delete(liveSession.id);
      recordChunkAggregate(liveSession.id, stats);
    }
    if (this.activeLiveSession === liveSession) {
      this.activeLiveSession = null;
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
  }): Promise<ResolvedStreamingSession | null> {
    const { sessionId } = options;
    const liveSession = this.activeLiveSession;
    if (!liveSession || liveSession.id !== sessionId) {
      logger.transcription.warn("No session found to resolve", { sessionId });
      return null;
    }

    // Sync prefix: the slot guard above and this close must run
    // before any yield point — a later chunk on the same tick must already
    // be refused.
    liveSession.closeChunkAdmission();
    try {
      const exit = await runPromiseExit(
        this.resolveEffect(liveSession, options),
      );
      // Boundary triage: typed failures rethrow; every defect in the
      // cause is reported once (the session bookkeeping dedups values the
      // chunk arm or an out-of-band channel already own), loudly.
      if (Exit.isFailure(exit)) {
        const fresh = Array.from(Cause.defects(exit.cause)).filter(
          (defect) => !liveSession.wasDefectReported(defect),
        );
        if (fresh.length > 0) {
          liveSession.markDefectsReported(fresh);
          logger.transcription.error("Dictation resolve defect", {
            sessionId,
            cause: Cause.pretty(exit.cause),
          });
          this.reportDefects(sessionId, fresh);
        }
      }
      return settleExit(exit);
    } finally {
      this.retireLiveSession(liveSession);
    }
  }

  /**
   * The resolve body as one Effect. Never interrupted: an abort
   * surfaces through the flush signal as a provider throw. Every synchronous
   * terminal gate lifts through a two-arg Effect.try so the latched error
   * object crosses the boundary unchanged.
   */
  private resolveEffect(
    liveSession: LiveTranscriptionSession,
    options: {
      sessionId: string;
    },
  ): Effect.Effect<ResolvedStreamingSession | null, DictationError> {
    const { sessionId } = options;
    const service = this;
    // The latch may hold a variant (typed failure) or an out-of-band defect;
    // refine by value so a latched defect surfaces as a defect.
    const terminalGate = Effect.try({
      try: () => liveSession.throwIfTerminalFailure(),
      catch: (error) => error,
    }).pipe(Effect.catchAll(failOrDie));

    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => liveSession.drainAdmittedChunks(),
        catch: (error) => error,
      }).pipe(
        Effect.catchAll(failOrDie),
        Effect.withSpan("resolve.drain", { attributes: { sessionId } }),
      );
      const session = liveSession.materializedSession;
      if (!session) {
        yield* terminalGate;
        return null;
      }

      yield* terminalGate;
      session.finalizationStartedAt = performance.now();

      const formatterConfig = yield* Effect.tryPromise({
        try: () => service.settingsService.getFormatterConfig(),
        catch: toDependencyFailure,
      });
      const shouldUseCloudFormatting =
        formatterConfig?.enabled &&
        isAmicalCloudSelectionValue(formatterConfig.modelId);
      const usedCloudProvider = session.providerSession.name === "amical-cloud";

      yield* withLock(
        service.transcriptionLock,
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* terminalGate;
            const finalResult = yield* Effect.tryPromise({
              try: () =>
                session.providerSession.flush(
                  {
                    ...service.buildTranscribeContextForSession(
                      sessionId,
                      session,
                    ),
                    formattingEnabled:
                      shouldUseCloudFormatting && usedCloudProvider,
                  },
                  liveSession.signal,
                ),
              catch: (error) => error,
            }).pipe(Effect.catchAll(failOrDie));
            yield* terminalGate;
            session.detectedLanguage = mergeDetectedLanguage(
              session.detectedLanguage,
              finalResult.detectedLanguage,
            );
            accumulateTranscriptionResult(
              session.transcriptionResults,
              finalResult.text,
              usedCloudProvider,
            );
          }),
        ),
      ).pipe(Effect.withSpan("resolve.flush", { attributes: { sessionId } }));

      const rawTranscription = session.transcriptionResults.join("");
      const prepared = yield* Effect.tryPromise({
        try: () =>
          prepareTranscriptText(
            {
              text: rawTranscription,
              usedCloudProvider,
              context: session.context,
              detectedLanguage: session.detectedLanguage,
            },
            {
              settingsService: service.settingsService,
              modelService: service.modelService,
            },
          ),
        catch: toDependencyFailure,
      }).pipe(Effect.withSpan("resolve.format", { attributes: { sessionId } }));
      yield* terminalGate;

      logger.transcription.info("Streaming session resolved", { sessionId });
      return {
        text: prepared.text,
        language: prepared.language,
        detectedLanguage: prepared.detectedLanguage,
        speechModel: session.speechModelId,
        formattingModel: prepared.formattingModel,
        meta: {
          source: session.context.audio.source,
          vocabularySize: session.context.vocabulary.length,
          formattingStyle: session.context.formattingStyle,
        },
      };
    }).pipe(
      Effect.withSpan("transcription.resolve", { attributes: { sessionId } }),
    );
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
          withLockPromise(this.transcriptionLock, work),
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

    return withLockPromise(this.vadLock, async () => {
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
   * Reset VAD state behind the VAD lock so it cannot interleave with retry VAD computation.
   */
  async resetVadForNewSession(): Promise<void> {
    await withLockPromise(this.vadLock, async () => {
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
