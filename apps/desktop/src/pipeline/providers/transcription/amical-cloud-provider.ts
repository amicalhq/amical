import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { AuthService as AuthServiceImpl } from "../../../services/auth-service";
import { getUserAgent } from "../../../utils/http-client";
import { detectApplicationType } from "../formatting/formatter-prompt";
import type { GetAccessibilityContextResult } from "@amical/types";
import {
  AppError,
  ErrorCodes,
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

// Type guard to validate error codes from server
const isValidErrorCode = (code: string | undefined): code is ErrorCode =>
  code !== undefined && Object.values(ErrorCodes).includes(code as ErrorCode);

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

type CloudTranscriptionResponse =
  | CloudTranscriptionSuccess
  | CloudTranscriptionError;

interface CloudAuth {
  isAuthenticated(): Effect.Effect<boolean, AppError>;
  getIdToken(): Effect.Effect<string | null, AppError>;
  refreshTokenIfNeeded(): Effect.Effect<void, AppError>;
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
  currentSilenceFrameCount: number;
  lastSpeechTimestamp: number;
  currentLanguage: string | undefined;
  currentAccessibilityContext: GetAccessibilityContextResult | null;
  currentAggregatedTranscription: string | undefined;
  currentVocabulary: string[];
  currentSessionId: string | undefined;
  grpcStream: CloudDictationGrpcStream | null;
  grpcPendingFrames: Float32Array[];
  grpcPendingSampleCount: number;
  grpcNextSeq: bigint;
  // Sticky override: once gRPC fails with a transport-level error, every
  // subsequent transcribe()/flush() in the session takes the HTTP path.
  // Cleared on reset()/dispose().
  transportOverride: "http" | null;
}

interface TranscriptionRequest {
  audioData: Float32Array;
  vadProbs: number[];
  isRetry?: boolean;
  enableFormatting?: boolean;
  isFinal?: boolean;
  snapshot?: ProviderRequestSnapshot;
}

interface ProviderRequestSnapshot {
  currentLanguage: string | undefined;
  currentAccessibilityContext: GetAccessibilityContextResult | null;
  currentAggregatedTranscription: string | undefined;
  currentVocabulary: string[];
  currentSessionId: string | undefined;
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

const toNetworkAppError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    error instanceof Error ? error.message : "Network error",
    ErrorCodes.NETWORK_ERROR,
  );
};

const CloudAuthLive = Layer.sync(CloudAuth, () => {
  const authService = AuthServiceImpl.getInstance();
  return {
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
    refreshTokenIfNeeded: () =>
      Effect.tryPromise({
        try: () => authService.refreshTokenIfNeeded(),
        catch: toNetworkAppError,
      }),
  };
});

const createInitialProviderState = (): ProviderState => ({
  frameBuffer: [],
  frameBufferSpeechProbabilities: [],
  currentSilenceFrameCount: 0,
  lastSpeechTimestamp: 0,
  currentLanguage: undefined,
  currentAccessibilityContext: null,
  currentAggregatedTranscription: undefined,
  currentVocabulary: [],
  currentSessionId: undefined,
  grpcStream: null,
  grpcPendingFrames: [],
  grpcPendingSampleCount: 0,
  grpcNextSeq: 1n,
  transportOverride: null,
});

/**
 * Decide whether a gRPC failure should trigger the HTTP fallback.
 *
 * Falls back on everything (proto/schema mismatches, server bugs, transport
 * breakage, deadlines, missing entities) — the HTTP path has looser validation
 * and a separate handler, so it may succeed where gRPC didn't.
 *
 * Carve-outs that surface instead:
 *   - AUTH_REQUIRED (401/403): HTTP would surface the same auth failure.
 *   - RATE_LIMIT_EXCEEDED (429): account-level throttle, same backend.
 *   - IDLE_TIMEOUT: orchestrator stopped feeding chunks; HTTP would also be starved.
 *   - CANCELLED (499): user-initiated (e.g., reset() during flush) — falling
 *     back would trigger a phantom HTTP transcription right after the user
 *     tried to stop.
 */
const shouldFallbackToHttp = (error: AppError): boolean => {
  if (error.errorCode === ErrorCodes.AUTH_REQUIRED) {
    return false;
  }
  if (error.errorCode === ErrorCodes.RATE_LIMIT_EXCEEDED) {
    return false;
  }
  // Idle timeout means the orchestrator stopped feeding chunks; HTTP would
  // be just as starved, so falling back wastes a roundtrip.
  if (error.errorCode === ErrorCodes.IDLE_TIMEOUT) {
    return false;
  }
  if (error.statusCode === 499) {
    return false;
  }
  return true;
};

const requestSnapshotFromState = (
  state: ProviderState,
): ProviderRequestSnapshot => ({
  currentLanguage: state.currentLanguage,
  currentAccessibilityContext: state.currentAccessibilityContext,
  currentAggregatedTranscription: state.currentAggregatedTranscription,
  currentVocabulary: state.currentVocabulary,
  currentSessionId: state.currentSessionId,
});

const createCloudRuntime = (config: CloudConfig) =>
  ManagedRuntime.make(
    Layer.mergeAll(CloudAuthLive, Layer.succeed(CloudConfig, config)),
  );

type CloudRuntime = ReturnType<typeof createCloudRuntime>;

const resetGrpcState = (state: ProviderState): ProviderState => ({
  ...state,
  grpcStream: null,
  grpcPendingFrames: [],
  grpcPendingSampleCount: 0,
  grpcNextSeq: 1n,
});

const resetProviderState = (): ProviderState => createInitialProviderState();

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
  private readonly state: Ref.Ref<ProviderState>;

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_AUDIO_DURATION_MS = 500; // Minimum buffered audio duration before silence-based transcription
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;

  constructor() {
    const config = cloudConfigFromEnvironment();
    this.runtime = createCloudRuntime(config);
    this.state = Effect.runSync(Ref.make(createInitialProviderState()));

    logger.transcription.info("AmicalCloudProvider initialized", {
      endpoint: config.apiEndpoint,
      transport: config.transport,
    });
  }

  /**
   * Process an audio chunk - buffers and conditionally transcribes
   */
  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
    return this.runProviderEffect(
      this.transcribeEffect(params).pipe(
        Effect.tapError((error) => this.logCloudErrorEffect(error)),
      ),
    );
  }

  private transcribeEffect(
    params: TranscribeParams,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const { audioData, speechProbability = 1, context } = params;

      yield* this.storeContextEffect(context);
      yield* this.ensureAuthenticatedEffect();

      const transport = yield* this.effectiveTransportEffect();

      if (transport === "grpc") {
        return yield* this.withHttpFallbackEffect(
          this.transcribeGrpcEffect(audioData, context),
          () => this.transcribeViaHttpEffect(audioData, speechProbability),
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
  ): CloudProviderEffect<A> {
    return grpcEffect.pipe(
      Effect.catchAll((error) =>
        shouldFallbackToHttp(error)
          ? Effect.gen(this, function* () {
              yield* this.engageHttpFallbackEffect(error);
              return yield* httpRoute();
            })
          : Effect.fail(error),
      ),
    );
  }

  /**
   * Warm the provider for an upcoming session: refresh auth if it's expiring
   * so the first transcribe() doesn't pay a token-refresh roundtrip.
   * Idempotent and cheap when the token is already fresh; safe to fire-and-forget.
   * Does NOT open the gRPC stream — that stays lazy on the first chunk.
   */
  async warmup(): Promise<void> {
    await AuthServiceImpl.getInstance().refreshTokenIfNeeded();
  }

  private transcribeViaHttpEffect(
    audioData: Float32Array,
    speechProbability: number,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      yield* this.bufferHttpFrameEffect(audioData, speechProbability);
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
  async flush(context: TranscribeContext): Promise<TranscriptionOutput> {
    return this.runProviderEffect(
      this.flushEffect(context).pipe(
        Effect.tapError((error) => this.logCloudErrorEffect(error)),
      ),
    );
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
      yield* this.storeContextEffect(context);
      yield* this.ensureAuthenticatedEffect();

      const enableFormatting = context.formattingEnabled ?? false;
      const transport = yield* this.effectiveTransportEffect();

      if (transport === "grpc") {
        // Note: audio sent over the failed gRPC stream is lost; the HTTP
        // fallback surfaces whatever HTTP-buffered audio (likely none) +
        // formatting-only output if enabled.
        return yield* this.withHttpFallbackEffect(
          this.flushGrpcEffect(enableFormatting),
          () => this.doTranscriptionEffect(enableFormatting, true),
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

  private engageHttpFallbackEffect(error: AppError): Effect.Effect<void> {
    return this.resetGrpcStreamEffect().pipe(
      Effect.zipRight(
        Ref.update(this.state, (state) => ({
          ...state,
          transportOverride: "http" as const,
        })),
      ),
      Effect.zipRight(
        Effect.sync(() =>
          logger.transcription.warn(
            "Cloud transcription falling back to HTTP after gRPC failure",
            {
              errorCode: error.errorCode,
              statusCode: error.statusCode,
              message: error.message,
              traceId: error.traceId,
            },
          ),
        ),
      ),
    );
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
    return Ref.update(this.state, (state) => ({
      ...state,
      currentLanguage: context.language,
      currentAccessibilityContext: context.accessibilityContext ?? null,
      currentAggregatedTranscription: context.aggregatedTranscription,
      currentVocabulary: context.vocabulary ?? [],
      currentSessionId: context.sessionId,
    }));
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

  /**
   * Clear internal buffers without transcribing
   * Called when cancelling a session to prevent audio bleed
   */
  reset(): void {
    this.runtime.runSync(this.resetEffect());
  }

  async dispose(): Promise<void> {
    await this.runtime.runPromise(this.resetEffect());
    await this.runtime.dispose();
  }

  private resetEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const stream = yield* Ref.modify(this.state, (state) => [
        state.grpcStream,
        resetProviderState(),
      ]);
      yield* Effect.sync(() => stream?.cancel());
    });
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
      const existingStream = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcStream),
      );
      if (existingStream) {
        return existingStream;
      }

      const config = yield* CloudConfig;
      const snapshot = yield* this.requestSnapshotEffect();
      const idToken = yield* this.getIdTokenEffect();
      const sessionId =
        snapshot.currentSessionId || `cloud-${Date.now().toString(36)}`;
      const openOptions = {
        endpoint: config.apiEndpoint,
        token: idToken,
        userAgent: getUserAgent(),
        sessionId,
        language: snapshot.currentLanguage,
        vocabulary: snapshot.currentVocabulary,
        formatting: enableFormatting,
        context: this.buildGrpcStreamContext(snapshot),
      };

      const stream = yield* Effect.try({
        try: () => new CloudDictationGrpcStream(openOptions),
        catch: (error) => this.toAppError(error),
      });
      const selectedStream = yield* Ref.modify(this.state, (state) => {
        if (state.grpcStream) {
          return [state.grpcStream, state] as const;
        }

        return [stream, { ...state, grpcStream: stream }] as const;
      });
      if (selectedStream !== stream) {
        yield* Effect.sync(() => stream.cancel());
        return selectedStream;
      }

      yield* Effect.sync(() => {
        logger.transcription.info("Cloud gRPC stream opened", {
          endpoint: config.apiEndpoint,
          sessionId,
          language: snapshot.currentLanguage,
          vocabularySize: snapshot.currentVocabulary.length,
          formatting: enableFormatting,
        });
      });

      return stream;
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
      const build = (code: ErrorCode, status: number | undefined) =>
        new AppError(error.message, code, {
          statusCode: status,
          traceId: error.traceId,
        });

      // Defense-in-depth idle close — distinct from user-cancellation even
      // though both surface as gRPC CANCELLED on the wire.
      if (error.isIdleTimeout) {
        return build(ErrorCodes.IDLE_TIMEOUT, undefined);
      }

      switch (error.grpcStatus) {
        case GrpcStatus.UNAUTHENTICATED:
          return build(ErrorCodes.AUTH_REQUIRED, 401);
        case GrpcStatus.RESOURCE_EXHAUSTED:
          return build(ErrorCodes.RATE_LIMIT_EXCEEDED, 429);
        case GrpcStatus.PERMISSION_DENIED:
          return build(ErrorCodes.AUTH_REQUIRED, 403);
      }

      switch (error.httpStatus) {
        case 401:
          return build(ErrorCodes.AUTH_REQUIRED, 401);
        case 403:
          return build(ErrorCodes.AUTH_REQUIRED, 403);
        case 429:
          return build(ErrorCodes.RATE_LIMIT_EXCEEDED, 429);
      }

      if (error.httpStatus && error.httpStatus >= 500) {
        return build(ErrorCodes.INTERNAL_SERVER_ERROR, error.httpStatus);
      }

      if (!error.httpStatus) {
        switch (error.grpcStatus) {
          case GrpcStatus.CANCELLED:
            return build(ErrorCodes.NETWORK_ERROR, 499);
          case GrpcStatus.INVALID_ARGUMENT:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR, 400);
          case GrpcStatus.DEADLINE_EXCEEDED:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR, 504);
          case GrpcStatus.NOT_FOUND:
            return build(ErrorCodes.UNKNOWN, 404);
          case GrpcStatus.ALREADY_EXISTS:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR, 409);
          case GrpcStatus.FAILED_PRECONDITION:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR, 412);
          case GrpcStatus.INTERNAL:
            return build(ErrorCodes.INTERNAL_SERVER_ERROR, 500);
          case GrpcStatus.UNAVAILABLE:
            return build(ErrorCodes.NETWORK_ERROR, 503);
        }
      }

      return build(ErrorCodes.UNKNOWN, error.httpStatus);
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

  private refreshTokenEffect(): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const auth = yield* CloudAuth;
      yield* auth.refreshTokenIfNeeded();
    });
  }

  private requestSnapshotEffect(): CloudProviderEffect<ProviderRequestSnapshot> {
    return Ref.get(this.state).pipe(Effect.map(requestSnapshotFromState));
  }

  private fetchTranscriptionEffect(
    snapshot: ProviderRequestSnapshot,
    idToken: string,
    audioData: Float32Array,
    vadProbs: number[],
    enableFormatting: boolean,
    isFinal: boolean,
  ): CloudProviderEffect<Response> {
    // Empty audio is the format-only path (text-only finalize); preserve the
    // original "" wire shape so the server's default float32 path keeps working.
    const hasAudio = audioData.length > 0;
    return Effect.gen(this, function* () {
      const config = yield* CloudConfig;
      const audioPayload = hasAudio
        ? Buffer.from(float32ToPcmS16le(audioData)).toString("base64")
        : "";
      return yield* Effect.tryPromise({
        try: () =>
          fetch(`${config.apiEndpoint}/transcribe`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
              "User-Agent": getUserAgent(),
            },
            body: JSON.stringify({
              sessionId: snapshot.currentSessionId,
              isFinal,
              audioData: audioPayload,
              audioFormat: hasAudio ? "pcm_s16le" : undefined,
              vadProbs,
              language: snapshot.currentLanguage,
              vocabulary: snapshot.currentVocabulary,
              previousTranscription: snapshot.currentAggregatedTranscription,
              formatting: {
                enabled: enableFormatting,
              },
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
        catch: (fetchError) =>
          new AppError(
            fetchError instanceof Error ? fetchError.message : "Network error",
            ErrorCodes.NETWORK_ERROR,
          ),
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
            statusCode: response.status,
          },
        ),
    });
  }

  private errorCodeForHttpResponse(
    response: Response,
    errorData: CloudErrorResponse | undefined,
  ): ErrorCode {
    if (isValidErrorCode(errorData?.code)) {
      return errorData.code;
    }
    if (response.status === 403) {
      return ErrorCodes.AUTH_REQUIRED;
    }
    if (response.status === 429) {
      return ErrorCodes.RATE_LIMIT_EXCEEDED;
    }
    if (response.status >= 500) {
      return ErrorCodes.INTERNAL_SERVER_ERROR;
    }
    return ErrorCodes.UNKNOWN;
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
    } = request;
    return Effect.gen(this, function* () {
      const requestSnapshot = snapshot ?? (yield* this.requestSnapshotEffect());

      if (audioData.length === 0) {
        const hasTextToFormat =
          enableFormatting &&
          requestSnapshot.currentAggregatedTranscription?.trim();
        if (!hasTextToFormat) {
          return { text: "" };
        }
      }

      const idToken = yield* this.getIdTokenEffect();
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
      );

      if (response.status === 401) {
        if (isRetry) {
          const errorData = yield* this.readCloudErrorResponseEffect(response);
          return yield* Effect.fail(
            new AppError(
              "Cloud auth failed after retry",
              ErrorCodes.AUTH_REQUIRED,
              {
                statusCode: 401,
                uiTitle: errorData?.ui?.title,
                uiMessage: errorData?.message,
                traceId: errorData?.id,
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
        yield* this.refreshTokenEffect().pipe(
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
                  { statusCode: 401 },
                ),
              );
            }),
          ),
        );

        return yield* this.makeTranscriptionRequestEffect({
          audioData,
          vadProbs,
          isRetry: true,
          enableFormatting,
          isFinal,
          snapshot: requestSnapshot,
        });
      }

      if (!response.ok) {
        const errorData = yield* this.readCloudErrorResponseEffect(response);

        yield* Effect.sync(() => {
          logger.transcription.error("Cloud API error:", {
            status: response.status,
            statusText: response.statusText,
            errorCode: errorData?.code,
            errorTitle: errorData?.ui?.title,
            errorMessage: errorData?.message,
            traceId: errorData?.id,
          });
        });

        return yield* Effect.fail(
          new AppError(
            `Cloud API error: ${response.status} ${response.statusText}`,
            this.errorCodeForHttpResponse(response, errorData),
            {
              statusCode: response.status,
              uiTitle: errorData?.ui?.title,
              uiMessage: errorData?.message,
              traceId: errorData?.id,
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
    });
  }
}
