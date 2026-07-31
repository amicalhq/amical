import {
  OpenTranscriptionSessionOptions,
  TranscriptionProvider,
  TranscriptionSession,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import type { AuthService } from "../../../services/auth-service";
import type { SettingsService } from "../../../services/settings-service";
import type { TelemetryService } from "../../../services/telemetry-service";
import type { CloudFallbackStage } from "../../../types/telemetry-events";
import {
  AMICAL_LAB_SELF_CORRECTION,
  AMICAL_LABS_HEADER,
  buildAmicalLabsHeader,
  getAmicalClientHeaders,
  getAmicalClientInfo,
  getUserAgent,
} from "../../../utils/http-client";
import { detectApplicationType } from "../formatting/formatter-prompt";
import type { GetAccessibilityContextResult } from "@amical/types";
import {
  AppError,
  DictationErrorCodes,
  ErrorCodes,
  isDictationErrorCode,
  mapDictationErrorCodeToErrorCode,
  type DictationErrorCode,
  type ErrorCode,
  type CloudErrorResponse,
} from "../../../types/error";
import { status as GrpcStatus } from "@grpc/grpc-js";
import { Context, Effect, Either, Layer, ManagedRuntime, Ref } from "effect";
import {
  CloudDictationGrpcStream,
  GrpcDictationError,
  type GrpcStreamContext,
  float32ToPcmS16le,
} from "./grpc-dictation-client";
import { resolveSessionSkills } from "./skill-resolution";
import type { DictationSkill } from "./dictation-skill";

// Success response from cloud API (HTTP 200)
interface CloudTranscriptionSuccess {
  success: true;
  transcription: string;
  originalTranscription?: string;
  language?: string;
  duration?: number;
}

// Error response from cloud API (HTTP 4xx/5xx)
interface CloudTranscriptionError {
  error: CloudErrorResponse;
}

interface ClassifiedHttpError {
  errorCode: ErrorCode;
  applicationCode?: DictationErrorCode;
}

type CloudTranscriptionResponse =
  | CloudTranscriptionSuccess
  | CloudTranscriptionError;

interface CloudAuth {
  isAuthenticated(): Effect.Effect<boolean, AppError>;
  getIdToken(): Effect.Effect<string | null, AppError>;
  refreshTokenIfNeeded(force?: boolean): Effect.Effect<void, AppError>;
}

const CloudAuth = Context.GenericTag<CloudAuth>(
  "AmicalCloudProvider/CloudAuth",
);

type Transport = "grpc" | "http";

interface CloudConfig {
  apiEndpoint: string;
  transport: Transport;
}

const CloudConfig = Context.GenericTag<CloudConfig>(
  "AmicalCloudProvider/CloudConfig",
);

type CloudProviderEnv = CloudAuth | CloudConfig;
type CloudProviderEffect<A> = Effect.Effect<A, AppError, CloudProviderEnv>;

interface ProviderState {
  frameBuffer: Float32Array[];
  frameBufferSpeechProbabilities: number[];
  // Mirror of all audio fed during the gRPC path, so an HTTP fallback can
  // re-transcribe the full utterance (gRPC-streamed audio is otherwise lost
  // when the stream fails). Independent of frameBuffer; seeded into it on
  // fallback. Bounded to one session — see storeContextEffect / reset.
  sessionAudioBuffer: Float32Array[];
  sessionAudioVadProbs: number[];
  currentSilenceFrameCount: number;
  lastSpeechTimestamp: number;
  currentLanguages: string[];
  currentAccessibilityContext: GetAccessibilityContextResult | null;
  currentAggregatedTranscription: string | undefined;
  currentVocabulary: string[];
  currentSessionId: string | undefined;
  // Sticky per-session: send the "instruct" preset (cloud generation) instead
  // of formatting. Set from TranscribeContext.isInstruct in storeContextEffect.
  currentIsInstruct: boolean;
  // Labs tokens resolved once per session in storeContextEffect (a settings DB
  // read), so per-chunk transcribe()/flush() snapshots stay in-memory.
  currentEnabledLabs: string[];
  grpcStream: CloudDictationGrpcStream | null;
  grpcSentContextKey: string | null;
  grpcSentSkillsKey: string | null;
  grpcPendingFrames: Float32Array[];
  grpcPendingSampleCount: number;
  grpcNextSeq: bigint;
  // In-flight HTTP-fallback fetch aborter; reset() aborts it so a finalize-phase
  // dismiss can cancel an HTTP flush mid-request (gRPC uses stream.cancel()).
  httpAbortController: AbortController | null;
  // Sticky-within-session override: once gRPC fails with a transport-level
  // error, every subsequent transcribe()/flush() in the *same* dictation
  // session takes the HTTP path. Cleared when storeContextEffect sees a new
  // sessionId, and on reset()/dispose() — so a transient drop does not stick
  // for the rest of the app run.
  transportOverride: "http" | null;
}

interface TranscriptionRequest {
  audioData: Float32Array;
  vadProbs: number[];
  isRetry?: boolean;
  enableFormatting?: boolean;
  isFinal?: boolean;
  snapshot?: ProviderRequestSnapshot;
  skills?: DictationSkill[];
}

interface ProviderRequestSnapshot {
  currentLanguages: string[];
  currentAccessibilityContext: GetAccessibilityContextResult | null;
  currentAggregatedTranscription: string | undefined;
  currentVocabulary: string[];
  currentSessionId: string | undefined;
  currentIsInstruct: boolean;
  enabledLabs: string[];
}

const projectAccessibilityContext = (
  ctx: GetAccessibilityContextResult | null,
): GrpcStreamContext | undefined => {
  if (!ctx) {
    return undefined;
  }

  return {
    selectedText: ctx.context?.textSelection?.selectedText ?? undefined,
    beforeText: ctx.context?.textSelection?.preSelectionText ?? undefined,
    afterText: ctx.context?.textSelection?.postSelectionText ?? undefined,
    appType: detectApplicationType(ctx),
    appBundleId: ctx.context?.application?.bundleIdentifier ?? undefined,
    appName: ctx.context?.application?.name ?? undefined,
    appUrl: ctx.context?.windowInfo?.url ?? undefined,
  };
};

const snapshotKey = (value: unknown): string => JSON.stringify(value);

const contextSnapshotKey = (
  context: GrpcStreamContext | undefined,
): string | null => (context ? snapshotKey(context) : null);

const toNetworkAppError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    error instanceof Error ? error.message : "Network error",
    ErrorCodes.NETWORK_ERROR,
  );
};

const makeCloudAuthLive = (authService: AuthService) =>
  Layer.sync(CloudAuth, () => ({
    isAuthenticated: () =>
      Effect.tryPromise({
        try: () => authService.isAuthenticated(),
        catch: toNetworkAppError,
      }),
    getIdToken: () =>
      Effect.tryPromise({
        try: () => authService.getIdToken(),
        catch: toNetworkAppError,
      }),
    refreshTokenIfNeeded: (force = false) =>
      Effect.tryPromise({
        try: () => authService.refreshTokenIfNeeded(force),
        catch: toNetworkAppError,
      }),
  }));

const createInitialProviderState = (): ProviderState => ({
  frameBuffer: [],
  frameBufferSpeechProbabilities: [],
  sessionAudioBuffer: [],
  sessionAudioVadProbs: [],
  currentSilenceFrameCount: 0,
  lastSpeechTimestamp: 0,
  currentLanguages: [],
  currentAccessibilityContext: null,
  currentAggregatedTranscription: undefined,
  currentVocabulary: [],
  currentSessionId: undefined,
  currentIsInstruct: false,
  currentEnabledLabs: [],
  grpcStream: null,
  grpcSentContextKey: null,
  grpcSentSkillsKey: null,
  grpcPendingFrames: [],
  grpcPendingSampleCount: 0,
  grpcNextSeq: 1n,
  transportOverride: null,
  httpAbortController: null,
});

/**
 * Decide whether a gRPC failure should trigger the HTTP fallback.
 *
 * Falls back on everything (proto/schema mismatches, server bugs, transport
 * breakage, deadlines, missing entities) — the HTTP path has looser validation
 * and a separate handler, so it may succeed where gRPC didn't.
 *
 * Carve-outs that surface instead:
 *   - AUTH_REQUIRED other than gRPC UNAUTHENTICATED: HTTP would surface the
 *     same auth failure.
 *   - RATE_LIMIT_EXCEEDED (429): account-level throttle, same backend.
 *   - QUOTA_EXCEEDED (402): plan/word-limit cap, same backend — retry won't help.
 *   - IDLE_TIMEOUT: orchestrator stopped feeding chunks; HTTP would also be starved.
 *   - CANCELLED: user-initiated (e.g., reset() during flush) — falling
 *     back would trigger a phantom HTTP transcription right after the user
 *     tried to stop.
 */
const NO_HTTP_FALLBACK_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCodes.AUTH_REQUIRED,
  ErrorCodes.RATE_LIMIT_EXCEEDED,
  ErrorCodes.QUOTA_EXCEEDED,
  ErrorCodes.IDLE_TIMEOUT,
]);

const NO_HTTP_FALLBACK_APPLICATION_CODES: ReadonlySet<DictationErrorCode> =
  new Set([
    DictationErrorCodes.AUTH_REQUIRED,
    DictationErrorCodes.FORBIDDEN,
    DictationErrorCodes.QUOTA_EXCEEDED,
    DictationErrorCodes.RATE_LIMIT_EXCEEDED,
    DictationErrorCodes.REQUEST_CANCELED,
  ]);

const shouldFallbackToHttp = (error: AppError): boolean => {
  // TODO: Remove this exception once gRPC can force-refresh and retry
  // UNAUTHENTICATED on a fresh stream. Until then, HTTP owns the 401 retry flow.
  if (error.grpcStatus === GrpcStatus.UNAUTHENTICATED) {
    return true;
  }
  if (NO_HTTP_FALLBACK_CODES.has(error.errorCode)) {
    return false;
  }
  if (
    error.applicationCode &&
    NO_HTTP_FALLBACK_APPLICATION_CODES.has(error.applicationCode)
  ) {
    return false;
  }
  if (error.grpcStatus === GrpcStatus.CANCELLED) {
    return false;
  }
  return true;
};

const requestSnapshotFromState = (
  state: ProviderState,
): ProviderRequestSnapshot => ({
  currentLanguages: state.currentLanguages,
  currentAccessibilityContext: state.currentAccessibilityContext,
  currentAggregatedTranscription: state.currentAggregatedTranscription,
  currentVocabulary: state.currentVocabulary,
  currentSessionId: state.currentSessionId,
  currentIsInstruct: state.currentIsInstruct,
  enabledLabs: state.currentEnabledLabs,
});

const createCloudRuntime = (config: CloudConfig, authService: AuthService) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      makeCloudAuthLive(authService),
      Layer.succeed(CloudConfig, config),
    ),
  );

type CloudRuntime = ReturnType<typeof createCloudRuntime>;

const resetGrpcState = (state: ProviderState): ProviderState => ({
  ...state,
  grpcStream: null,
  grpcSentContextKey: null,
  grpcSentSkillsKey: null,
  grpcPendingFrames: [],
  grpcPendingSampleCount: 0,
  grpcNextSeq: 1n,
});

const resetProviderState = (): ProviderState => createInitialProviderState();
const LEGACY_CLOUD_SESSION_ID = "legacy-cloud";

const cloudConfigFromEnvironment = (): CloudConfig => {
  const apiEndpoint = process.env.API_ENDPOINT || __BUNDLED_API_ENDPOINT;
  // Runtime-only escape hatch; the bundled default is intentionally gRPC.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const configuredTransport = process.env.CLOUD_DICTATION_TRANSPORT || "";

  return {
    apiEndpoint,
    transport:
      configuredTransport.trim().toLowerCase() === "http" ? "http" : "grpc",
  };
};

export class AmicalCloudProvider implements TranscriptionProvider {
  readonly name = "amical-cloud";

  private readonly runtime: CloudRuntime;
  private readonly telemetryService: TelemetryService | null;
  private readonly settingsService: SettingsService | null;
  private readonly sessions = new Set<AmicalCloudSession>();
  private legacySession: AmicalCloudSession | null = null;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;

  constructor(
    private readonly authService: AuthService,
    telemetryService: TelemetryService | null = null,
    settingsService: SettingsService | null = null,
  ) {
    const config = cloudConfigFromEnvironment();
    this.runtime = createCloudRuntime(config, authService);
    this.telemetryService = telemetryService;
    this.settingsService = settingsService;

    logger.transcription.info("AmicalCloudProvider initialized", {
      endpoint: config.apiEndpoint,
      transport: config.transport,
    });
  }

  openSession(options: OpenTranscriptionSessionOptions): TranscriptionSession {
    return this.createSession(options.sessionId);
  }

  private createSession(sessionId: string): AmicalCloudSession {
    this.assertNotDisposed();
    const session = new AmicalCloudSession(
      sessionId,
      this.runtime,
      this.telemetryService,
      this.settingsService,
      (closedSession) => this.retireSession(closedSession),
    );
    this.sessions.add(session);
    return session;
  }

  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    const sessionId =
      params.context.sessionId ??
      this.legacySession?.sessionId ??
      LEGACY_CLOUD_SESSION_ID;
    return this.legacySessionFor(sessionId).transcribe(params);
  }

  async flush(
    context: TranscribeContext,
    signal?: AbortSignal,
  ): Promise<TranscriptionOutput> {
    const sessionId =
      context.sessionId ??
      this.legacySession?.sessionId ??
      LEGACY_CLOUD_SESSION_ID;
    return this.legacySessionFor(sessionId).flush(context, signal);
  }

  async updateSessionContext(context: TranscribeContext): Promise<void> {
    this.assertNotDisposed();
    const sessionId =
      context.sessionId ??
      this.legacySession?.sessionId ??
      LEGACY_CLOUD_SESSION_ID;
    if (!this.legacySession || this.legacySession.sessionId !== sessionId) {
      return;
    }
    await this.legacySession.updateSessionContext(context);
  }

  reset(): void {
    this.legacySession?.cancel();
    this.legacySession = null;
  }

  /**
   * Warm the provider for an upcoming session: refresh auth if it's expiring
   * so the first transcribe() doesn't pay a token-refresh roundtrip.
   * Does not open a transport connection.
   */
  async warmup(): Promise<void> {
    this.assertNotDisposed();
    await this.authService.refreshTokenIfNeeded();
    this.assertNotDisposed();
  }

  dispose(): Promise<void> {
    if (!this.disposalPromise) {
      this.disposed = true;
      this.disposalPromise = this.disposeInternal();
    }
    return this.disposalPromise;
  }

  private legacySessionFor(sessionId: string): AmicalCloudSession {
    this.assertNotDisposed();
    if (!this.legacySession || this.legacySession.sessionId !== sessionId) {
      this.reset();
      this.legacySession = this.createSession(sessionId);
    }
    return this.legacySession;
  }

  private retireSession(session: AmicalCloudSession): void {
    this.sessions.delete(session);
    if (this.legacySession === session) {
      this.legacySession = null;
    }
  }

  private async disposeInternal(): Promise<void> {
    for (const session of [...this.sessions]) {
      session.cancel();
    }
    this.sessions.clear();
    await this.runtime.dispose();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Amical cloud transcription provider has been disposed");
    }
  }
}

/** Mutable Cloud transport state for exactly one transcription operation. */
class AmicalCloudSession implements TranscriptionSession {
  readonly name = "amical-cloud";

  private readonly state: Ref.Ref<ProviderState>;
  private closed = false;

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_AUDIO_DURATION_MS = 500; // Minimum buffered audio duration before silence-based transcription
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;

  constructor(
    readonly sessionId: string,
    private readonly runtime: CloudRuntime,
    private readonly telemetryService: TelemetryService | null,
    private readonly settingsService: SettingsService | null,
    private readonly onCancel: (session: AmicalCloudSession) => void,
  ) {
    this.state = Effect.runSync(Ref.make(createInitialProviderState()));
  }

  /**
   * Process an audio chunk - buffers and conditionally transcribes
   */
  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    this.assertOpen();
    const result = await this.runProviderEffect(
      this.transcribeEffect({
        ...params,
        context: this.contextForSession(params.context),
      }).pipe(Effect.tapError((error) => this.logCloudErrorEffect(error))),
    );
    this.assertOpen();
    return result;
  }

  private transcribeEffect(
    params: TranscribeParams,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const { audioData, speechProbability = 1, context } = params;

      yield* this.failIfClosedEffect();
      yield* this.storeContextEffect(context);
      yield* this.ensureAuthenticatedEffect();
      yield* this.failIfClosedEffect();

      const transport = yield* this.effectiveTransportEffect();

      if (transport === "grpc") {
        yield* this.mirrorSessionAudioEffect(audioData, speechProbability);
        return yield* this.withHttpFallbackEffect(
          this.transcribeGrpcEffect(audioData, context),
          () => this.transcribeFromBufferEffect(),
          "transcribe",
        );
      }

      return yield* this.transcribeViaHttpEffect(audioData, speechProbability);
    });
  }

  /**
   * If the gRPC effect fails with a fallback-eligible error, engage HTTP
   * fallback then re-route via the HTTP path. Otherwise re-fail the error.
   */
  private withHttpFallbackEffect<A>(
    grpcEffect: CloudProviderEffect<A>,
    httpRoute: () => CloudProviderEffect<A>,
    stage: CloudFallbackStage,
  ): CloudProviderEffect<A> {
    return grpcEffect.pipe(
      Effect.catchAll((error) =>
        !this.closed && shouldFallbackToHttp(error)
          ? Effect.gen(this, function* () {
              yield* this.failIfClosedEffect();
              yield* this.engageHttpFallbackEffect(error, stage);
              yield* this.failIfClosedEffect();
              return yield* httpRoute();
            })
          : Effect.fail(error),
      ),
    );
  }

  async updateSessionContext(context: TranscribeContext): Promise<void> {
    this.assertOpen();
    await this.runProviderEffect(
      this.updateSessionContextEffect(this.contextForSession(context)).pipe(
        Effect.tapError((error) => this.logCloudErrorEffect(error)),
      ),
    );
    this.assertOpen();
  }

  private updateSessionContextEffect(
    context: TranscribeContext,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      yield* this.failIfClosedEffect();
      yield* this.storeContextEffect(context);
      yield* this.failIfClosedEffect();
      const transport = yield* this.effectiveTransportEffect();
      if (transport !== "grpc") {
        return;
      }

      const stream = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcStream),
      );
      if (!stream) {
        return;
      }

      yield* this.sendGrpcSessionUpdatesEffect(
        stream,
        context.formattingEnabled ?? false,
      );
    });
  }

  private transcribeViaHttpEffect(
    audioData: Float32Array,
    speechProbability: number,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      yield* this.bufferHttpFrameEffect(audioData, speechProbability);
      return yield* this.transcribeFromBufferEffect();
    });
  }

  /**
   * Transcribe whatever is already in frameBuffer, without buffering a new
   * chunk. Used as the transcribe-stage HTTP fallback route: the current chunk
   * was already captured by the session mirror and seeded into frameBuffer by
   * engageHttpFallbackEffect, so re-buffering it here would duplicate audio.
   */
  private transcribeFromBufferEffect(): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const shouldTranscribe = yield* this.shouldTranscribeEffect();
      if (!shouldTranscribe) {
        return { text: "" };
      }
      return yield* this.doTranscriptionEffect(false);
    });
  }

  /**
   * Flush any buffered audio and return transcription with formatting
   * Called at the end of a recording session
   */
  async flush(
    context: TranscribeContext,
    signal?: AbortSignal,
  ): Promise<TranscriptionOutput> {
    this.assertOpen();
    const sessionContext = this.contextForSession(context);
    // Dismiss/cancel arrives as an aborted signal. cancel() synchronously cancels
    // the in-flight gRPC stream and aborts the HTTP fetch, rejecting this flush so
    // finalizeSession's catch persists the row and returns to idle immediately.
    // (No-op for the local worker; that path lives in WhisperProvider.) Checked
    // up-front too because addEventListener won't fire for an already-aborted
    // signal.
    if (signal?.aborted) {
      this.cancel();
      throw this.cancellationError();
    }
    const onAbort = () => this.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await this.runProviderEffect(
        this.flushEffect(sessionContext).pipe(
          Effect.tapError((error) => this.logCloudErrorEffect(error)),
        ),
      );
      this.assertOpen();
      return result;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private contextForSession(context: TranscribeContext): TranscribeContext {
    return { ...context, sessionId: this.sessionId };
  }

  /**
   * Run a CloudProviderEffect and unwrap typed failures into raw thrown errors,
   * so external Promise consumers see `AppError` directly instead of Effect's
   * FiberFailure wrapper.
   */
  private async runProviderEffect<A>(
    effect: CloudProviderEffect<A>,
  ): Promise<A> {
    const result = await this.runtime.runPromise(Effect.either(effect));
    if (Either.isLeft(result)) {
      throw result.left;
    }
    return result.right;
  }

  private flushEffect(
    context: TranscribeContext,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      yield* this.failIfClosedEffect();
      yield* this.storeContextEffect(context);
      yield* this.ensureAuthenticatedEffect();
      yield* this.failIfClosedEffect();

      const enableFormatting = context.formattingEnabled ?? false;
      const transport = yield* this.effectiveTransportEffect();

      if (transport === "grpc") {
        return yield* this.withHttpFallbackEffect(
          this.flushGrpcEffect(enableFormatting),
          () => this.doTranscriptionEffect(enableFormatting, true),
          "flush",
        );
      }

      return yield* this.doTranscriptionEffect(enableFormatting, true);
    });
  }

  private effectiveTransportEffect(): CloudProviderEffect<Transport> {
    return Effect.gen(this, function* () {
      const config = yield* CloudConfig;
      const state = yield* Ref.get(this.state);
      return state.transportOverride ?? config.transport;
    });
  }

  private engageHttpFallbackEffect(
    error: AppError,
    stage: CloudFallbackStage,
  ): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      yield* this.resetGrpcStreamEffect();
      const sessionId = yield* Ref.modify(this.state, (state) => [
        state.currentSessionId,
        {
          ...state,
          transportOverride: "http" as const,
          // Recover the full utterance: prepend everything streamed over the
          // (now failed) gRPC stream ahead of any HTTP-buffered audio.
          frameBuffer: [...state.sessionAudioBuffer, ...state.frameBuffer],
          frameBufferSpeechProbabilities: [
            ...state.sessionAudioVadProbs,
            ...state.frameBufferSpeechProbabilities,
          ],
          sessionAudioBuffer: [],
          sessionAudioVadProbs: [],
        },
      ]);
      yield* Effect.sync(() => {
        logger.transcription.warn(
          "Cloud transcription falling back to HTTP after gRPC failure",
          {
            errorCode: error.errorCode,
            applicationCode: error.applicationCode,
            grpcStatus: error.grpcStatus,
            httpStatus: error.httpStatus,
            message: error.message,
            traceId: error.traceId,
            stage,
            sessionId,
          },
        );
        this.telemetryService?.trackCloudGrpcFallback({
          error_code: error.errorCode,
          application_code: error.applicationCode,
          grpc_status: error.grpcStatus,
          http_status: error.httpStatus,
          message: error.message,
          trace_id: error.traceId,
          session_id: sessionId,
          fallback_stage: stage,
        });
      });
    });
  }

  /**
   * Shared transcription logic - aggregates buffer, calls cloud API, clears state
   * @param enableFormatting - Whether to enable formatting
   * @param isFinal - Whether this is the final call for the session (default: false)
   */
  private doTranscriptionEffect(
    enableFormatting: boolean,
    isFinal = false,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const { combinedAudio, vadProbs } = yield* Ref.modify(
        this.state,
        (
          state,
        ): readonly [
          { combinedAudio: Float32Array; vadProbs: number[] },
          ProviderState,
        ] => {
          const totalLength = state.frameBuffer.reduce(
            (acc, frame) => acc + frame.length,
            0,
          );
          const combinedAudio = new Float32Array(totalLength);
          let offset = 0;
          for (const frame of state.frameBuffer) {
            combinedAudio.set(frame, offset);
            offset += frame.length;
          }

          const vadProbs = [...state.frameBufferSpeechProbabilities];

          const nextState: ProviderState = {
            ...state,
            frameBuffer: [],
            frameBufferSpeechProbabilities: [],
            currentSilenceFrameCount: 0,
          };

          return [{ combinedAudio, vadProbs }, nextState] as const;
        },
      );

      return yield* this.makeTranscriptionRequestEffect({
        audioData: combinedAudio,
        vadProbs,
        enableFormatting,
        isFinal,
      });
    });
  }

  private storeContextEffect(
    context: TranscribeContext,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      // Each new session is a fresh chance to retry gRPC; clear any sticky
      // HTTP override left over from a drop in the previous session.
      const prevSessionId = (yield* Ref.get(this.state)).currentSessionId;
      const isNewSession =
        context.sessionId !== undefined && context.sessionId !== prevSessionId;

      // Resolve labs once per session here rather than per request, so the
      // per-chunk HTTP snapshot doesn't re-read settings from disk on every
      // transcribe()/flush(). null = keep the value already cached in state.
      const enabledLabs = isNewSession ? yield* this.enabledLabsEffect() : null;
      yield* this.failIfClosedEffect();

      yield* Ref.update(this.state, (state) => ({
        ...state,
        currentLanguages: context.languages ?? [],
        currentAccessibilityContext: context.accessibilityContext ?? null,
        currentAggregatedTranscription: context.aggregatedTranscription,
        currentVocabulary: context.vocabulary ?? [],
        currentSessionId: context.sessionId,
        currentIsInstruct: context.isInstruct ?? false,
        currentEnabledLabs: enabledLabs ?? state.currentEnabledLabs,
        transportOverride: isNewSession ? null : state.transportOverride,
        sessionAudioBuffer: isNewSession ? [] : state.sessionAudioBuffer,
        sessionAudioVadProbs: isNewSession ? [] : state.sessionAudioVadProbs,
      }));
    });
  }

  private ensureAuthenticatedEffect(): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const auth = yield* CloudAuth;
      const isAuthenticated = yield* auth.isAuthenticated();

      if (!isAuthenticated) {
        return yield* Effect.fail(
          new AppError(
            "Authentication required for cloud transcription",
            ErrorCodes.AUTH_REQUIRED,
          ),
        );
      }
    });
  }

  /**
   * Append a chunk to the session-wide audio mirror used to reconstruct the
   * full utterance if gRPC fails and we fall back to HTTP. Only invoked while
   * gRPC is the active transport; the HTTP path owns frameBuffer afterwards.
   */
  private mirrorSessionAudioEffect(
    audioData: Float32Array,
    speechProbability: number,
  ): CloudProviderEffect<void> {
    if (audioData.length === 0) {
      return Effect.void;
    }
    return Ref.update(this.state, (state) => ({
      ...state,
      sessionAudioBuffer: [...state.sessionAudioBuffer, audioData],
      sessionAudioVadProbs: [...state.sessionAudioVadProbs, speechProbability],
    }));
  }

  private bufferHttpFrameEffect(
    audioData: Float32Array,
    speechProbability: number,
  ): CloudProviderEffect<void> {
    return Ref.update(this.state, (state) => {
      const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;
      const now = Date.now();

      return {
        ...state,
        frameBuffer: [...state.frameBuffer, audioData],
        frameBufferSpeechProbabilities: [
          ...state.frameBufferSpeechProbabilities,
          speechProbability,
        ],
        currentSilenceFrameCount: isSpeech
          ? 0
          : state.currentSilenceFrameCount + 1,
        lastSpeechTimestamp: isSpeech ? now : state.lastSpeechTimestamp,
      };
    });
  }

  cancel(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const inFlight = Effect.runSync(
      Ref.modify(this.state, (state) => [
        {
          stream: state.grpcStream,
          httpAbortController: state.httpAbortController,
        },
        resetProviderState(),
      ]),
    );
    try {
      inFlight.stream?.cancel();
    } catch (error) {
      logger.transcription.warn("Failed to cancel cloud gRPC stream", {
        sessionId: this.sessionId,
        error,
      });
    }
    try {
      inFlight.httpAbortController?.abort();
    } catch (error) {
      logger.transcription.warn("Failed to abort cloud HTTP request", {
        sessionId: this.sessionId,
        error,
      });
    }
    this.onCancel(this);
  }

  private transcribeGrpcEffect(
    audioData: Float32Array,
    context: TranscribeContext,
  ): CloudProviderEffect<TranscriptionOutput> {
    if (audioData.length === 0) {
      return Effect.succeed({ text: "" });
    }

    return Effect.gen(this, function* () {
      yield* this.enqueueGrpcAudioEffect(audioData);
      yield* this.ensureGrpcStreamEffect(context.formattingEnabled ?? false);
      yield* this.sendReadyGrpcPacketsEffect(false);
      return { text: "" };
    }).pipe(
      Effect.catchAll((error) =>
        this.resetGrpcStreamEffect().pipe(Effect.zipRight(Effect.fail(error))),
      ),
    );
  }

  private flushGrpcEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.state);
      if (!state.grpcStream && state.grpcPendingSampleCount === 0) {
        return { text: "" };
      }

      return yield* this.finalizeGrpcStreamEffect(enableFormatting).pipe(
        Effect.map((result) => ({
          text: result.formattedTranscript || result.rawTranscript,
        })),
        Effect.ensuring(this.clearGrpcAudioStateEffect()),
      );
    });
  }

  private finalizeGrpcStreamEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<{
    rawTranscript: string;
    formattedTranscript: string;
  }> {
    return Effect.gen(this, function* () {
      const stream = yield* this.ensureGrpcStreamEffect(enableFormatting);
      // Final re-sync: flush any context/skills change that landed since the
      // last push but wasn't sent (e.g. a dropped mid-session push). The server
      // formats the final transcript against the latest snapshot, so this is
      // the one place it has to be current. Dedup keys make it a no-op when the
      // pushes already landed.
      yield* this.sendGrpcSessionUpdatesEffect(stream, enableFormatting);
      yield* this.sendReadyGrpcPacketsEffect(true);

      return yield* Effect.tryPromise({
        try: () => stream.finalize(),
        catch: (error) => this.toAppError(error),
      });
    });
  }

  private ensureGrpcStreamEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<CloudDictationGrpcStream> {
    return Effect.gen(this, function* () {
      yield* this.failIfClosedEffect();
      const existingStream = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcStream),
      );
      // Pure get-or-create: mid-session context/skills changes are pushed by
      // updateSessionContext, and a final re-sync happens in
      // finalizeGrpcStreamEffect. Don't re-send snapshots from here, or every
      // chunk (and every audio packet) pays for a snapshot diff.
      if (existingStream) {
        return existingStream;
      }

      const config = yield* CloudConfig;
      const snapshot = yield* this.requestSnapshotEffect();
      const idToken = yield* this.getIdTokenEffect();
      yield* this.failIfClosedEffect();
      const sessionId =
        snapshot.currentSessionId || `cloud-${Date.now().toString(36)}`;
      // Instruct uses its preset; formatting off produces no skills. Otherwise
      // the foreground app maps to a preset, with tone added only when
      // personalization is enabled. See skill-resolution.ts.
      const resolvedSkills = yield* Effect.promise(() =>
        resolveSessionSkills({
          isInstruct: snapshot.currentIsInstruct,
          enableFormatting,
          accessibilityContext: snapshot.currentAccessibilityContext,
        }),
      );
      yield* this.failIfClosedEffect();
      const streamContext = this.buildGrpcStreamContext(snapshot);
      const sentContextKey = contextSnapshotKey(streamContext);
      const sentSkillsKey = snapshotKey(resolvedSkills);
      const openOptions = {
        endpoint: config.apiEndpoint,
        token: idToken,
        userAgent: getUserAgent(),
        clientInfo: getAmicalClientInfo(),
        sessionId,
        languages: snapshot.currentLanguages,
        vocabulary: snapshot.currentVocabulary,
        formatting: enableFormatting,
        resolvedSkills,
        context: streamContext,
        labs: snapshot.enabledLabs,
      };

      const stream = yield* Effect.try({
        try: () => new CloudDictationGrpcStream(openOptions),
        catch: (error) => this.toAppError(error),
      });
      const selectedStream = yield* Ref.modify(this.state, (state) => {
        if (state.grpcStream) {
          return [state.grpcStream, state] as const;
        }

        return [
          stream,
          {
            ...state,
            grpcStream: stream,
            grpcSentContextKey: sentContextKey,
            grpcSentSkillsKey: sentSkillsKey,
          },
        ] as const;
      });
      if (selectedStream !== stream) {
        yield* Effect.sync(() => stream.cancel());
        return selectedStream;
      }

      yield* Effect.sync(() => {
        logger.transcription.info("Cloud gRPC stream opened", {
          endpoint: config.apiEndpoint,
          sessionId,
          languages: snapshot.currentLanguages,
          vocabularySize: snapshot.currentVocabulary.length,
          formatting: enableFormatting,
          instruct: snapshot.currentIsInstruct,
        });
      });

      return stream;
    });
  }

  private sendGrpcSessionUpdatesEffect(
    stream: CloudDictationGrpcStream,
    enableFormatting: boolean,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const snapshot = yield* this.requestSnapshotEffect();
      const streamContext = this.buildGrpcStreamContext(snapshot);
      const nextContextKey = contextSnapshotKey(streamContext);
      const sentContextKey = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcSentContextKey),
      );

      if (streamContext && nextContextKey !== sentContextKey) {
        yield* Effect.tryPromise({
          try: () => stream.sendContextUpdate(streamContext),
          catch: (error) => this.toAppError(error),
        });
        yield* Ref.update(this.state, (state) => ({
          ...state,
          grpcSentContextKey: nextContextKey,
        }));
      }

      yield* this.failIfClosedEffect();
      const resolvedSkills = yield* Effect.promise(() =>
        resolveSessionSkills({
          isInstruct: snapshot.currentIsInstruct,
          enableFormatting,
          accessibilityContext: snapshot.currentAccessibilityContext,
        }),
      );
      yield* this.failIfClosedEffect();
      const nextSkillsKey = snapshotKey(resolvedSkills);
      const sentSkillsKey = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcSentSkillsKey),
      );

      if (nextSkillsKey !== sentSkillsKey) {
        yield* Effect.tryPromise({
          try: () => stream.sendSkillsUpdate(resolvedSkills),
          catch: (error) => this.toAppError(error),
        });
        yield* Ref.update(this.state, (state) => ({
          ...state,
          grpcSentSkillsKey: nextSkillsKey,
        }));
      }
    });
  }

  private enqueueGrpcAudioEffect(
    audioData: Float32Array,
  ): CloudProviderEffect<void> {
    if (audioData.length === 0) {
      return Effect.void;
    }

    return Ref.update(this.state, (state) => ({
      ...state,
      grpcPendingFrames: [...state.grpcPendingFrames, audioData],
      grpcPendingSampleCount: state.grpcPendingSampleCount + audioData.length,
    }));
  }

  private takeGrpcPacketEffect(
    padFinalPacket: boolean,
  ): CloudProviderEffect<Float32Array | null> {
    const packetSamples = CloudDictationGrpcStream.PACKET_SAMPLES;
    return Ref.modify(this.state, (state) => {
      if (
        state.grpcPendingSampleCount < packetSamples &&
        !(padFinalPacket && state.grpcPendingSampleCount > 0)
      ) {
        return [null, state] as const;
      }

      const packet = new Float32Array(packetSamples);
      let written = 0;
      let grpcPendingSampleCount = state.grpcPendingSampleCount;
      const grpcPendingFrames = [...state.grpcPendingFrames];

      while (written < packetSamples && grpcPendingFrames.length > 0) {
        const frame = grpcPendingFrames[0]!;
        const samplesNeeded = packetSamples - written;
        const samplesToCopy = Math.min(frame.length, samplesNeeded);

        packet.set(frame.subarray(0, samplesToCopy), written);
        written += samplesToCopy;

        if (samplesToCopy === frame.length) {
          grpcPendingFrames.shift();
        } else {
          grpcPendingFrames[0] = frame.subarray(samplesToCopy);
        }

        grpcPendingSampleCount -= samplesToCopy;
      }

      return [
        packet,
        {
          ...state,
          grpcPendingFrames,
          grpcPendingSampleCount,
        },
      ] as const;
    });
  }

  private sendReadyGrpcPacketsEffect(
    padFinalPacket: boolean,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      while (true) {
        const packet = yield* this.takeGrpcPacketEffect(padFinalPacket);
        if (!packet) {
          return;
        }

        yield* this.sendGrpcPacketEffect(float32ToPcmS16le(packet));
      }
    });
  }

  private sendGrpcPacketEffect(packet: Uint8Array): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const stream = yield* this.ensureGrpcStreamEffect(false);
      const seq = yield* Ref.modify(this.state, (state) => [
        state.grpcNextSeq,
        {
          ...state,
          grpcNextSeq: state.grpcNextSeq + 1n,
        },
      ]);
      yield* Effect.tryPromise({
        try: () => stream.sendAudioBatch(seq, [packet]),
        catch: (error) => this.toAppError(error),
      });
    });
  }

  private buildGrpcStreamContext(
    snapshot: ProviderRequestSnapshot,
  ): GrpcStreamContext | undefined {
    return projectAccessibilityContext(snapshot.currentAccessibilityContext);
  }

  private resetGrpcStreamEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const stream = yield* Ref.modify(this.state, (state) => [
        state.grpcStream,
        resetGrpcState(state),
      ]);
      yield* Effect.sync(() => stream?.cancel());
    });
  }

  private clearGrpcAudioStateEffect(): Effect.Effect<void> {
    return Ref.update(this.state, resetGrpcState);
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof GrpcDictationError) {
      const build = (code: ErrorCode, applicationCode?: DictationErrorCode) =>
        new AppError(error.message, code, {
          applicationCode,
          grpcStatus: error.grpcStatus,
          httpStatus: error.httpStatus,
          traceId: error.traceId,
          uiMessage: applicationCode ? error.localizedMessage : undefined,
        });

      // Defense-in-depth idle close — distinct from user-cancellation even
      // though both surface as gRPC CANCELLED on the wire.
      if (error.isIdleTimeout) {
        return build(ErrorCodes.IDLE_TIMEOUT);
      }

      if (isDictationErrorCode(error.applicationCode)) {
        return build(
          mapDictationErrorCodeToErrorCode(error.applicationCode),
          error.applicationCode,
        );
      }

      switch (error.grpcStatus) {
        case GrpcStatus.UNAUTHENTICATED:
          return build(ErrorCodes.AUTH_REQUIRED);
        // The server's only RESOURCE_EXHAUSTED case today is a plan/word-limit
        // cap, not a per-second throttle — surface as QUOTA_EXCEEDED so the
        // user sees an Upgrade CTA instead of a generic rate-limit message.
        case GrpcStatus.RESOURCE_EXHAUSTED:
          if (error.applicationCode) {
            return build(ErrorCodes.INTERNAL_SERVER_ERROR);
          }
          return build(ErrorCodes.QUOTA_EXCEEDED);
        case GrpcStatus.PERMISSION_DENIED:
          return build(ErrorCodes.AUTH_REQUIRED);
      }

      switch (error.httpStatus) {
        case 401:
          return build(ErrorCodes.AUTH_REQUIRED);
        case 402:
          return build(ErrorCodes.QUOTA_EXCEEDED);
        case 403:
          return build(ErrorCodes.AUTH_REQUIRED);
        case 429:
          return build(ErrorCodes.RATE_LIMIT_EXCEEDED);
      }

      if (error.httpStatus && error.httpStatus >= 500) {
        return build(ErrorCodes.INTERNAL_SERVER_ERROR);
      }

      if (!error.httpStatus) {
        switch (error.grpcStatus) {
          case GrpcStatus.CANCELLED:
            return build(ErrorCodes.NETWORK_ERROR);
          case GrpcStatus.INVALID_ARGUMENT:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR);
          case GrpcStatus.DEADLINE_EXCEEDED:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR);
          case GrpcStatus.NOT_FOUND:
            return build(ErrorCodes.UNKNOWN);
          case GrpcStatus.ALREADY_EXISTS:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR);
          case GrpcStatus.FAILED_PRECONDITION:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR);
          case GrpcStatus.INTERNAL:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR);
          case GrpcStatus.UNAVAILABLE:
            return build(ErrorCodes.NETWORK_ERROR);
        }
      }

      return build(ErrorCodes.UNKNOWN);
    }

    return new AppError(
      error instanceof Error ? error.message : "Network error",
      ErrorCodes.NETWORK_ERROR,
    );
  }

  private shouldTranscribeEffect(): CloudProviderEffect<boolean> {
    return Ref.get(this.state).pipe(
      Effect.map((state) => {
        const silenceDuration =
          ((state.currentSilenceFrameCount * this.FRAME_SIZE) /
            this.SAMPLE_RATE) *
          1000;
        const audioDuration =
          ((state.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) *
          1000;

        return (
          audioDuration >= this.MIN_AUDIO_DURATION_MS &&
          silenceDuration >= this.MAX_SILENCE_DURATION_MS
        );
      }),
    );
  }

  private logCloudErrorEffect(error: AppError): CloudProviderEffect<void> {
    return Effect.sync(() => {
      logger.transcription.error("Cloud transcription error:", error);
    });
  }

  private cancellationError(): AppError {
    return new AppError(
      "Cloud transcription was cancelled",
      ErrorCodes.NETWORK_ERROR,
    );
  }

  private assertOpen(): void {
    if (this.closed) {
      throw this.cancellationError();
    }
  }

  private failIfClosedEffect(): Effect.Effect<void, AppError> {
    return this.closed ? Effect.fail(this.cancellationError()) : Effect.void;
  }

  private getIdTokenEffect(): CloudProviderEffect<string> {
    return Effect.gen(this, function* () {
      const auth = yield* CloudAuth;
      const idToken = yield* auth.getIdToken();

      if (!idToken) {
        return yield* Effect.fail(
          new AppError(
            "No authentication token available",
            ErrorCodes.AUTH_REQUIRED,
          ),
        );
      }

      return idToken;
    });
  }

  private refreshTokenEffect(force = false): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const auth = yield* CloudAuth;
      yield* auth.refreshTokenIfNeeded(force);
    });
  }

  private requestSnapshotEffect(): CloudProviderEffect<ProviderRequestSnapshot> {
    return Ref.get(this.state).pipe(Effect.map(requestSnapshotFromState));
  }

  private enabledLabsEffect(): CloudProviderEffect<string[]> {
    const settingsService = this.settingsService;
    if (!settingsService) {
      return Effect.succeed([]);
    }

    return Effect.tryPromise(() => settingsService.getLabsSettings()).pipe(
      Effect.map((labsSettings) =>
        labsSettings.selfCorrection ? [AMICAL_LAB_SELF_CORRECTION] : [],
      ),
      Effect.catchAll((error) => {
        logger.transcription.warn("Failed to read labs settings", {
          error: error instanceof Error ? error.message : String(error),
        });
        return Effect.succeed<string[]>([]);
      }),
    );
  }

  private fetchTranscriptionEffect(
    snapshot: ProviderRequestSnapshot,
    idToken: string,
    audioData: Float32Array,
    vadProbs: number[],
    enableFormatting: boolean,
    isFinal: boolean,
    skills: DictationSkill[] | undefined,
    signal: AbortSignal,
  ): CloudProviderEffect<Response> {
    // Empty audio is the text-only finalize path; preserve the
    // original "" wire shape so the server's default float32 path keeps working.
    const hasAudio = audioData.length > 0;
    return Effect.gen(this, function* () {
      const config = yield* CloudConfig;
      const audioPayload = hasAudio
        ? Buffer.from(float32ToPcmS16le(audioData)).toString("base64")
        : "";
      const labsHeader = buildAmicalLabsHeader(snapshot.enabledLabs);
      return yield* Effect.tryPromise({
        try: () =>
          fetch(`${config.apiEndpoint}/transcribe`, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
              "User-Agent": getUserAgent(),
              ...getAmicalClientHeaders(),
              ...(labsHeader ? { [AMICAL_LABS_HEADER]: labsHeader } : {}),
            },
            body: JSON.stringify({
              sessionId: snapshot.currentSessionId,
              isFinal,
              audioData: audioPayload,
              audioFormat: hasAudio ? "pcm_s16le" : undefined,
              vadProbs,
              languages: snapshot.currentLanguages,
              vocabulary: snapshot.currentVocabulary,
              previousTranscription: snapshot.currentAggregatedTranscription,
              formatting: {
                enabled: enableFormatting,
              },
              skills,
              sharedContext: snapshot.currentAccessibilityContext
                ? {
                    ...projectAccessibilityContext(
                      snapshot.currentAccessibilityContext,
                    ),
                    surroundingContext: "",
                  }
                : undefined,
            }),
          }),
        // A dismiss-triggered abort surfaces here as a rejected fetch; map it
        // like any network failure. (No special CANCELLED/499 code is needed —
        // shouldFallbackToHttp only inspects the gRPC attempt, never this HTTP
        // route, so an aborted fetch can't spawn a phantom fallback.)
        catch: toNetworkAppError,
      });
    });
  }

  private readCloudErrorResponseEffect(
    response: Response,
  ): CloudProviderEffect<CloudErrorResponse | undefined> {
    return Effect.promise(async () => {
      try {
        const result = (await response.json()) as CloudTranscriptionResponse;
        if ("error" in result) {
          return result.error;
        }
      } catch {
        // Response body wasn't valid JSON
      }

      return undefined;
    });
  }

  private readCloudSuccessResponseEffect(
    response: Response,
  ): CloudProviderEffect<CloudTranscriptionSuccess> {
    return Effect.tryPromise({
      try: async () => (await response.json()) as CloudTranscriptionSuccess,
      catch: () =>
        new AppError(
          "Invalid cloud API response",
          ErrorCodes.INTERNAL_SERVER_ERROR,
          {
            httpStatus: response.status,
          },
        ),
    });
  }

  private classifyHttpError(
    response: Response,
    errorData: CloudErrorResponse | undefined,
  ): ClassifiedHttpError {
    if (isDictationErrorCode(errorData?.code)) {
      return {
        errorCode: mapDictationErrorCodeToErrorCode(errorData.code),
        applicationCode: errorData.code,
      };
    }
    if (response.status === 401) {
      return { errorCode: ErrorCodes.AUTH_REQUIRED };
    }
    if (response.status === 402) {
      return { errorCode: ErrorCodes.QUOTA_EXCEEDED };
    }
    if (response.status === 403) {
      return { errorCode: ErrorCodes.AUTH_REQUIRED };
    }
    if (response.status === 429) {
      return { errorCode: ErrorCodes.RATE_LIMIT_EXCEEDED };
    }
    if (response.status >= 500) {
      return { errorCode: ErrorCodes.INTERNAL_SERVER_ERROR };
    }
    return { errorCode: ErrorCodes.UNKNOWN };
  }

  private makeTranscriptionRequestEffect(
    request: TranscriptionRequest,
  ): CloudProviderEffect<TranscriptionOutput> {
    const {
      audioData,
      vadProbs,
      isRetry = false,
      enableFormatting = false,
      isFinal = false,
      snapshot,
      skills: preResolvedSkills,
    } = request;
    const abortController = new AbortController();
    const releaseRequest = Ref.update(this.state, (state) =>
      state.httpAbortController === abortController
        ? { ...state, httpAbortController: null }
        : state,
    );

    return Effect.gen(this, function* () {
      yield* this.failIfClosedEffect();
      const requestSnapshot = snapshot ?? (yield* this.requestSnapshotEffect());
      const hasPriorText =
        !!requestSnapshot.currentAggregatedTranscription?.trim();
      if (audioData.length === 0 && !hasPriorText) {
        return { text: "" };
      }

      // Resolve final skills before the empty-audio no-op check so text-only
      // instruct behaves the same as gRPC even when formatting is toggled off.
      const skills =
        preResolvedSkills ??
        (isFinal
          ? yield* Effect.promise(() =>
              resolveSessionSkills({
                isInstruct: requestSnapshot.currentIsInstruct,
                enableFormatting,
                accessibilityContext:
                  requestSnapshot.currentAccessibilityContext,
              }),
            )
          : undefined);
      yield* this.failIfClosedEffect();
      if (audioData.length === 0) {
        const shouldSendTextOnlyFinal =
          isFinal && (enableFormatting || (skills?.length ?? 0) > 0);
        if (!shouldSendTextOnlyFinal) {
          return { text: "" };
        }
      }

      // Register before token lookup. Auth remains non-interruptible, but a
      // cancelled session cannot install a fetch after that lookup completes.
      yield* Ref.update(this.state, (state) => ({
        ...state,
        httpAbortController: abortController,
      }));
      const idToken = yield* this.getIdTokenEffect();
      yield* this.failIfClosedEffect();
      const duration = audioData.length / this.SAMPLE_RATE;

      yield* Effect.sync(() => {
        logger.transcription.info("Sending audio to cloud API", {
          audioLength: audioData.length,
          sampleRate: this.SAMPLE_RATE,
          duration,
          isRetry,
          formatting: enableFormatting,
          sessionId: requestSnapshot.currentSessionId,
          isFinal,
        });
      });

      const response = yield* this.fetchTranscriptionEffect(
        requestSnapshot,
        idToken,
        audioData,
        vadProbs,
        enableFormatting,
        isFinal,
        skills,
        abortController.signal,
      );

      if (response.status === 401) {
        if (isRetry) {
          const errorData = yield* this.readCloudErrorResponseEffect(response);
          const classifiedError = this.classifyHttpError(response, errorData);
          return yield* Effect.fail(
            new AppError(
              errorData?.message ?? "Cloud auth failed after retry",
              classifiedError.errorCode,
              {
                applicationCode: classifiedError.applicationCode,
                httpStatus: response.status,
                uiTitle: errorData?.ui?.title,
                uiMessage: classifiedError.applicationCode
                  ? errorData?.localizedMessage?.message
                  : undefined,
                traceId: errorData?.traceId ?? errorData?.id,
              },
            ),
          );
        }

        yield* Effect.sync(() => {
          logger.transcription.warn(
            "Got 401 response, attempting token refresh and retry",
          );
        });

        // Force token refresh, then retry once. Retry failures should surface as
        // their own errors instead of being collapsed into auth failure.
        yield* this.refreshTokenEffect(true).pipe(
          Effect.catchAll((refreshError) =>
            Effect.gen(this, function* () {
              yield* Effect.sync(() => {
                logger.transcription.error(
                  "Token refresh failed:",
                  refreshError,
                );
              });
              return yield* Effect.fail(
                new AppError(
                  "Authentication failed - please log in again",
                  ErrorCodes.AUTH_REQUIRED,
                  { httpStatus: 401 },
                ),
              );
            }),
          ),
        );
        yield* this.failIfClosedEffect();

        return yield* this.makeTranscriptionRequestEffect({
          audioData,
          vadProbs,
          isRetry: true,
          enableFormatting,
          isFinal,
          skills,
          snapshot: requestSnapshot,
        });
      }

      if (!response.ok) {
        const errorData = yield* this.readCloudErrorResponseEffect(response);
        const classifiedError = this.classifyHttpError(response, errorData);

        yield* Effect.sync(() => {
          logger.transcription.error("Cloud API error:", {
            status: response.status,
            statusText: response.statusText,
            errorCode: errorData?.code,
            errorTitle: errorData?.ui?.title,
            errorMessage: errorData?.message,
            localizedErrorMessage: errorData?.localizedMessage?.message,
            traceId: errorData?.traceId ?? errorData?.id,
          });
        });

        return yield* Effect.fail(
          new AppError(
            errorData?.message ??
              `Cloud API error: ${response.status} ${response.statusText}`,
            classifiedError.errorCode,
            {
              applicationCode: classifiedError.applicationCode,
              httpStatus: response.status,
              uiTitle: errorData?.ui?.title,
              uiMessage: classifiedError.applicationCode
                ? errorData?.localizedMessage?.message
                : undefined,
              traceId: errorData?.traceId ?? errorData?.id,
            },
          ),
        );
      }

      const result = yield* this.readCloudSuccessResponseEffect(response);

      yield* Effect.sync(() => {
        logger.transcription.info("Cloud transcription successful", {
          textLength: result.transcription.length,
          language: result.language,
          duration: result.duration,
          transcription: result.transcription,
        });
      });

      return {
        text: result.transcription,
        detectedLanguage: result.language,
      };
    }).pipe(Effect.ensuring(releaseRequest));
  }
}
