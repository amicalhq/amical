import { status as GrpcStatus } from "@grpc/grpc-js";
import { Effect, Layer, ManagedRuntime, Ref } from "effect";
import {
  OpenTranscriptionSessionOptions,
  TranscriptionEngine,
  TranscriptionProviderSession,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import type { AuthService } from "../../../services/auth-service";
import type { SettingsService } from "../../../services/settings-service";
import type { TelemetryService } from "../../../services/telemetry-service";
import type { CloudFallbackStage } from "../../../types/telemetry-events";
import { isDictationErrorCode } from "../../../types/error";
import {
  AuthenticationRequired,
  Cancelled,
  CloudDisposed,
  codeOf,
  isCloudError,
  settleExit,
  tagOf,
  type CloudError,
  type CloudRequestMeta,
} from "../../../types/errors";
import { recordDefect } from "../../../main/telemetry/dictation-trace";
import { AMICAL_LAB_SELF_CORRECTION } from "../../../utils/http-client";
import {
  AmicalCloudGrpcTransport,
  type ObservedGrpcStreamFailure,
} from "./amical-cloud-grpc-transport";
import { AmicalCloudHttpTransport } from "./amical-cloud-http-transport";
import {
  CloudAuth,
  CloudConfig,
  createInitialProviderState,
  resetGrpcState,
  resetProviderState,
  toNetworkFailure,
  type CloudProviderEffect,
  type ProviderState,
  type Transport,
} from "./amical-cloud-provider-state";

const makeCloudAuthLive = (authService: AuthService) =>
  Layer.sync(CloudAuth, () => ({
    isAuthenticated: () =>
      Effect.tryPromise({
        try: () => authService.isAuthenticated(),
        catch: toNetworkFailure,
      }),
    getIdToken: () =>
      Effect.tryPromise({
        try: () => authService.getIdToken(),
        catch: toNetworkFailure,
      }),
    refreshTokenIfNeeded: (force = false) =>
      Effect.tryPromise({
        try: () => authService.refreshTokenIfNeeded(force),
        catch: toNetworkFailure,
      }),
  }));

const createCloudRuntime = (config: CloudConfig, authService: AuthService) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      makeCloudAuthLive(authService),
      Layer.succeed(CloudConfig, config),
    ),
  );

type CloudRuntime = ReturnType<typeof createCloudRuntime>;

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
 *   - CANCELLED: user-initiated (for example, cancel() during flush) — falling
 *     back would trigger a phantom HTTP transcription right after the user
 *     tried to stop.
 *   - FORBIDDEN: the server rejected the caller outright; HTTP would reject
 *     the same credentials.
 */
const metaOf = (error: CloudError): CloudRequestMeta | undefined =>
  "meta" in error ? error.meta : undefined;

const shouldFallbackToHttp = (error: CloudError): boolean => {
  // TODO: Remove this exception once gRPC can force-refresh and retry
  // UNAUTHENTICATED on a fresh stream. Until then, HTTP owns the 401 retry
  // flow — variant-independent, exactly like the legacy field check.
  if (metaOf(error)?.grpcStatus === GrpcStatus.UNAUTHENTICATED) {
    return true;
  }
  switch (error._tag) {
    case "AuthenticationRequired":
    case "AccessForbidden":
    case "RateLimited":
    case "CloudQuotaExceeded":
    case "IdleTimeout":
    case "Cancelled":
      return false;
  }
  if (metaOf(error)?.grpcStatus === GrpcStatus.CANCELLED) {
    return false;
  }
  return true;
};

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

export class AmicalCloudProvider implements TranscriptionEngine {
  readonly name = "amical-cloud";

  private readonly runtime: CloudRuntime;
  private readonly telemetryService: TelemetryService | null;
  private readonly settingsService: SettingsService | null;
  private readonly sessions = new Set<AmicalCloudSession>();
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

  openSession(
    options: OpenTranscriptionSessionOptions,
  ): TranscriptionProviderSession {
    this.assertNotDisposed();
    const session = new AmicalCloudSession(
      options.sessionId,
      this.runtime,
      this.telemetryService,
      this.settingsService,
      options.onTerminalFailure,
      (closedSession) => this.sessions.delete(closedSession),
    );
    this.sessions.add(session);
    return session;
  }

  /**
   * Warm the engine for an upcoming session: refresh auth if it's expiring
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

  private async disposeInternal(): Promise<void> {
    for (const session of [...this.sessions]) {
      session.cancel();
    }
    this.sessions.clear();
    await this.runtime.dispose();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new CloudDisposed({
        message: "Amical cloud transcription engine has been disposed",
      });
    }
  }
}

/**
 * Mutable cloud state for exactly one transcription operation. The engine owns
 * only reusable auth/config resources; transport buffers and cancellation are
 * never shared across sessions.
 */
class AmicalCloudSession implements TranscriptionProviderSession {
  readonly name = "amical-cloud";

  private readonly state: Ref.Ref<ProviderState>;
  private readonly grpcTransport: AmicalCloudGrpcTransport;
  private readonly httpTransport: AmicalCloudHttpTransport;
  private closed = false;

  constructor(
    readonly sessionId: string,
    private readonly runtime: CloudRuntime,
    private readonly telemetryService: TelemetryService | null,
    private readonly settingsService: SettingsService | null,
    private readonly onTerminalFailure: ((error: Error) => void) | undefined,
    private readonly onCancel: (session: AmicalCloudSession) => void,
  ) {
    this.state = Effect.runSync(Ref.make(createInitialProviderState()));
    const failIfClosedEffect = () => this.failIfClosedEffect();
    this.grpcTransport = new AmicalCloudGrpcTransport(
      this.state,
      failIfClosedEffect,
      (failure) => this.handleObservedGrpcFailure(failure),
    );
    this.httpTransport = new AmicalCloudHttpTransport(
      this.state,
      failIfClosedEffect,
    );
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
          this.grpcTransport.transcribeGrpcEffect(audioData, context),
          () => this.httpTransport.transcribeFromBufferEffect(),
          "transcribe",
        );
      }

      return yield* this.httpTransport.transcribeViaHttpEffect(
        audioData,
        speechProbability,
      );
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
        Effect.gen(this, function* () {
          if (this.closed) {
            return yield* Effect.fail(error);
          }
          const state = yield* Ref.get(this.state);
          if (state.transportOverride === "http") {
            return yield* httpRoute();
          }
          if (!shouldFallbackToHttp(error)) {
            return yield* Effect.fail(error);
          }

          yield* this.engageHttpFallbackEffect(error, stage);
          yield* this.failIfClosedEffect();
          return yield* httpRoute();
        }),
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

      yield* this.grpcTransport.updateOpenStreamEffect(
        context.formattingEnabled ?? false,
      );
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
    // the in-flight gRPC stream and aborts the HTTP fetch, rejecting this flush;
    // the lifecycle has already sealed, so the caller drops the rejection.
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
   * Run a CloudProviderEffect and settle it cause-aware: a typed failure
   * rejects with the variant, a defect rethrows, and a mixed cause settles
   * with the typed value while its co-defects are reported here — the one
   * point below the service where they would otherwise vanish.
   */
  private async runProviderEffect<A>(
    effect: CloudProviderEffect<A>,
  ): Promise<A> {
    const exit = await this.runtime.runPromiseExit(effect);
    return settleExit(exit, (defects) => this.reportDroppedDefects(defects));
  }

  private reportDroppedDefects(defects: ReadonlyArray<unknown>): void {
    for (const defect of defects) {
      logger.transcription.error(
        "Dropped co-defect at cloud provider exit",
        defect,
      );
      this.telemetryService?.captureException(defect, {
        source: "dictation",
        session_id: this.sessionId,
      });
    }
    recordDefect(this.sessionId);
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
          this.grpcTransport.flushGrpcEffect(enableFormatting),
          () => this.httpTransport.flushEffect(enableFormatting),
          "flush",
        );
      }

      return yield* this.httpTransport.flushEffect(enableFormatting);
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
    error: CloudError,
    stage: CloudFallbackStage,
    expectedStream?: NonNullable<ProviderState["grpcStream"]>,
  ): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const fallback = yield* Ref.modify(this.state, (state) => {
        if (
          state.transportOverride === "http" ||
          (expectedStream !== undefined && state.grpcStream !== expectedStream)
        ) {
          return [null, state] as const;
        }

        return [
          {
            sessionId: state.currentSessionId,
            stage:
              expectedStream !== undefined ? state.grpcFallbackStage : stage,
            stream: state.grpcStream,
          },
          this.moveGrpcAudioToHttpState(state),
        ] as const;
      });
      if (!fallback) {
        return;
      }

      yield* Effect.sync(() => {
        fallback.stream?.cancel();
        this.reportHttpFallback(error, fallback.stage, fallback.sessionId);
      });
    });
  }

  private moveGrpcAudioToHttpState(state: ProviderState): ProviderState {
    return {
      ...resetGrpcState(state),
      transportOverride: "http",
      // Recover the full utterance in one HTTP buffer. The 28-second threshold
      // starts a flush; it does not slice an already larger fallback backlog.
      frameBuffer: [...state.sessionAudioBuffer, ...state.frameBuffer],
      frameBufferSpeechProbabilities: [
        ...state.sessionAudioVadProbs,
        ...state.frameBufferSpeechProbabilities,
      ],
      sessionAudioBuffer: [],
      sessionAudioVadProbs: [],
    };
  }

  private handleObservedGrpcFailure({
    stream,
    error,
  }: ObservedGrpcStreamFailure): void {
    if (!isCloudError(error)) {
      // A foreign value from the background channel is a client bug, not a
      // network condition: log loud, deliver terminally (projects UNKNOWN),
      // never consult the fallback matrix. Capture belongs to latch
      // ACCEPTANCE in the service — the once-latch is the serializer, so a
      // channel that loses the delivery race can never double-capture.
      logger.transcription.error(
        "Foreign failure on the observed gRPC channel",
        error,
      );
      if (this.closed) {
        return;
      }
      const currentStream = Effect.runSync(Ref.get(this.state)).grpcStream;
      if (currentStream !== stream) {
        return;
      }
      stream.cancel();
      this.onTerminalFailure?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    if (this.closed) {
      return;
    }

    if (shouldFallbackToHttp(error)) {
      // Only switch routes here. The next serialized chunk or final flush owns
      // the HTTP request and can return its cumulative transcript to the service.
      Effect.runSync(
        this.engageHttpFallbackEffect(error, "transcribe", stream),
      );
      return;
    }

    const currentStream = Effect.runSync(Ref.get(this.state)).grpcStream;
    if (currentStream !== stream) {
      return;
    }

    stream.cancel();
    this.onTerminalFailure?.(error);
  }

  private reportHttpFallback(
    error: CloudError,
    stage: CloudFallbackStage,
    sessionId: string | undefined,
  ): void {
    const meta = metaOf(error);
    const applicationCode = isDictationErrorCode(meta?.wireCode)
      ? meta.wireCode
      : undefined;
    logger.transcription.warn(
      "Cloud transcription falling back to HTTP after gRPC failure",
      {
        errorCode: codeOf(error),
        errorTag: tagOf(error),
        applicationCode,
        grpcStatus: meta?.grpcStatus,
        httpStatus: meta?.httpStatus,
        message: error.message,
        traceId: meta?.traceId,
        stage,
        sessionId,
      },
    );
    this.telemetryService?.trackCloudGrpcFallback({
      error_code: codeOf(error),
      application_code: applicationCode,
      grpc_status: meta?.grpcStatus,
      http_status: meta?.httpStatus,
      message: error.message,
      trace_id: meta?.traceId,
      session_id: sessionId,
      fallback_stage: stage,
    });
  }

  private storeContextEffect(
    context: TranscribeContext,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const isFirstContext =
        (yield* Ref.get(this.state)).currentSessionId === undefined;

      // Resolve labs once per session here rather than per request, so the
      // per-chunk HTTP snapshot doesn't re-read settings from disk on every
      // transcribe()/flush(). null = keep the value already cached in state.
      const enabledLabs = isFirstContext
        ? yield* this.enabledLabsEffect()
        : null;
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
      }));
    });
  }

  private ensureAuthenticatedEffect(): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const auth = yield* CloudAuth;
      const isAuthenticated = yield* auth.isAuthenticated();

      if (!isAuthenticated) {
        return yield* Effect.fail(
          new AuthenticationRequired({
            message: "Authentication required for cloud transcription",
          }),
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

  private logCloudErrorEffect(error: CloudError): CloudProviderEffect<void> {
    return Effect.sync(() => {
      logger.transcription.error("Cloud transcription error:", error);
    });
  }

  private cancellationError(): CloudError {
    return new Cancelled({ message: "Cloud transcription was cancelled" });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw this.cancellationError();
    }
  }

  private failIfClosedEffect(): Effect.Effect<void, CloudError> {
    return this.closed ? Effect.fail(this.cancellationError()) : Effect.void;
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
}
