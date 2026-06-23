import {
  ChannelCredentials,
  Client,
  Metadata,
  status as grpcStatusCode,
  type ChannelOptions,
  type ClientDuplexStream,
  type ServiceError,
  type StatusObject,
} from "@grpc/grpc-js";
import { Deferred, Effect, Either, Ref } from "effect";
import {
  AudioEncoding,
  Language,
  STREAM_TRANSCRIBE_PATH,
  StreamCancelCode,
  StreamTranscribeEvent,
  StreamTranscribeRequest,
} from "./gen/amical/dictation/v1/dictation";
import {
  AMICAL_LABS_HEADER,
  AMICAL_CLIENT_HEADER,
  AMICAL_PLATFORM_HEADER,
  AMICAL_VERSION_HEADER,
  buildAmicalLabsHeader,
  type AmicalClientInfo,
} from "../../../utils/http-client";
import { logger } from "../../../main/logger";
import type { DictationSkill } from "./dictation-skill";

export interface GrpcStreamContext {
  selectedText?: string;
  beforeText?: string;
  afterText?: string;
  appType?: string;
  appBundleId?: string;
  appName?: string;
  appUrl?: string;
}

export interface GrpcDictationStreamOptions {
  endpoint: string;
  token: string;
  userAgent: string;
  clientInfo: AmicalClientInfo;
  sessionId: string;
  languages?: string[];
  vocabulary: string[];
  // Initial set of resolved skills sent immediately after StreamOpen.
  // Empty/undefined -> no initial skills update.
  // Use sendSkillsUpdate() on the stream to replace this set mid-flight.
  resolvedSkills?: DictationSkill[];
  context?: GrpcStreamContext;
  // Formatting toggle state carried on StreamOpen.
  formatting?: boolean;
  labs?: readonly string[];
}

export interface GrpcFinalTranscript {
  rawTranscript: string;
  formattedTranscript: string;
  throughSeq: bigint;
}

export class GrpcDictationError extends Error {
  constructor(
    message: string,
    public readonly grpcStatus?: number,
    public readonly httpStatus?: number,
    public readonly traceId?: string,
    public readonly isIdleTimeout?: boolean,
  ) {
    super(message);
    this.name = "GrpcDictationError";
  }
}

const TRACE_ID_HEADER = "x-trace-id";
const AUTHORIZATION_HEADER = "authorization";
// Desktop recordings auto-stop at 6 minutes; keep the RPC deadline above that
// ceiling so the server, not the transport, handles normal session completion.
const STREAM_DEADLINE_MS = 7 * 60 * 1000;
const KEEPALIVE_TIME_MS = 5 * 1000;
const KEEPALIVE_TIMEOUT_MS = 3 * 1000;
const MAX_GRPC_MESSAGE_BYTES = 4 * 1024 * 1024;
const CANCEL_FRAME_FLUSH_TIMEOUT_MS = 1000;
const CLOSE_STATUS_GRACE_MS = 100;
// Defense-in-depth: if no audio batch is sent for this long, the orchestrator
// is presumed stuck. Close the stream so the server can release resources.
// Audio chunks normally arrive every ~32ms while recording, so any gap of
// this magnitude indicates a bug elsewhere, not normal pause behavior.
const IDLE_TIMEOUT_MS = 10 * 1000;
const GRPC_JS_HTTP_STATUS_DETAILS_PATTERN =
  /\bReceived HTTP status code (?<status>\d{3})\b/i;

const getFirstMetadataString = (
  metadata: Metadata | undefined,
  key: string,
): string | undefined => {
  const first = metadata?.get(key)[0];
  // grpc-js returns Buffer values for binary metadata keys and string values
  // for ordinary headers; trace IDs should be ordinary strings.
  if (Buffer.isBuffer(first)) {
    return first.toString("utf8");
  }
  return typeof first === "string" ? first : undefined;
};

const runEffectPromise = async <A>(
  effect: Effect.Effect<A, Error>,
): Promise<A> => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    throw result.left;
  }
  return result.right;
};

const runEffectSync = <A>(effect: Effect.Effect<A, Error>): A => {
  const result = Effect.runSync(Effect.either(effect));
  if (Either.isLeft(result)) {
    throw result.left;
  }
  return result.right;
};

type UInt64Value =
  | bigint
  | number
  | string
  | { toString(): string }
  | null
  | undefined;

interface StreamTranscribeEventMessage {
  final?: {
    rawTranscript?: string;
    formattedTranscript?: string;
    throughSeq?: UInt64Value;
  };
}

const encodeStreamTranscribeRequest = (
  request: Record<string, unknown>,
): Buffer =>
  Buffer.from(
    StreamTranscribeRequest.encode(
      StreamTranscribeRequest.create(request),
    ).finish(),
  );

const enumValue = (values: Record<string, number>, name: string): number => {
  const value = values[name];
  if (typeof value !== "number") {
    throw new Error(`Missing protobuf enum value: ${name}`);
  }
  return value;
};

const languageEnumForCode = (language?: string): number | undefined => {
  if (!language) {
    return undefined;
  }

  return Language.values[
    `LANGUAGE_${language.toUpperCase().replace(/-/g, "_")}`
  ];
};

const toBigInt = (value: UInt64Value): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (value === null || typeof value === "undefined") {
    return 0n;
  }
  return BigInt(value.toString());
};

export const buildLanguageConfig = (languages?: string[]) => {
  const items = (languages ?? [])
    .map((code) => languageEnumForCode(code))
    .filter((enumValue): enumValue is number => typeof enumValue === "number");

  if (items.length === 0) {
    return { auto: {} };
  }

  return {
    languages: { items },
  };
};

const buildStreamContext = (context: GrpcStreamContext) => {
  return {
    selectedText: context.selectedText,
    beforeText: context.beforeText,
    afterText: context.afterText,
    appType: context.appType,
    appBundleId: context.appBundleId,
    appName: context.appName,
    appUrl: context.appUrl,
  };
};

const encodeOpenRequest = (options: GrpcDictationStreamOptions): Buffer => {
  return encodeStreamTranscribeRequest({
    open: {
      sessionId: options.sessionId,
      audioConfig: {
        encoding: enumValue(AudioEncoding.values, "AUDIO_ENCODING_PCM_S16LE"),
        packetDurationMs: CloudDictationGrpcStream.PACKET_DURATION_MS,
      },
      language: buildLanguageConfig(options.languages),
      vocabulary: options.vocabulary,
      formatting: options.formatting,
    },
  });
};

const encodeContextUpdateRequest = (context: GrpcStreamContext): Buffer => {
  return encodeStreamTranscribeRequest({
    contextUpdate: {
      context: buildStreamContext(context),
    },
  });
};

const buildSkill = (skill: DictationSkill) => {
  const args: Record<string, { values: string[] }> = {};
  if (skill.args) {
    for (const [key, values] of Object.entries(skill.args)) {
      args[key] = { values };
    }
  }
  const out: Record<string, unknown> = {
    args,
  };
  if (skill.customPrompt !== undefined) {
    out.customPrompt = skill.customPrompt;
  } else {
    // Default arm of the body oneof. `preset` is empty-string when callers
    // pass neither preset nor customPrompt — server falls back to default.
    out.preset = skill.preset ?? "";
  }
  return out;
};

const encodeSkillsUpdateRequest = (skills: DictationSkill[]): Buffer => {
  return encodeStreamTranscribeRequest({
    skillsUpdate: {
      resolvedSkills: skills.map(buildSkill),
    },
  });
};

// Compact, log-safe view of the skills going over the wire. Custom prompts
// can be long/sensitive, so log only their length rather than the full text.
const summarizeSkillsForLog = (skills: DictationSkill[]) =>
  skills.map((skill) => ({
    mode: skill.customPrompt !== undefined ? "custom" : "preset",
    preset: skill.customPrompt !== undefined ? undefined : (skill.preset ?? ""),
    customPromptLength: skill.customPrompt?.length,
    args: skill.args,
  }));

const encodeAudioBatchRequest = (
  firstSeq: bigint,
  chunks: Uint8Array[],
): Buffer => {
  return encodeStreamTranscribeRequest({
    audio: {
      firstSeq: firstSeq.toString(),
      chunks,
    },
  });
};

const encodeFinalizeRequest = (): Buffer => {
  return encodeStreamTranscribeRequest({
    finalize: {},
  });
};

const encodeCancelRequest = (): Buffer => {
  return encodeStreamTranscribeRequest({
    cancel: {
      code: enumValue(
        StreamCancelCode.values,
        "STREAM_CANCEL_CODE_USER_ABORTED",
      ),
    },
  });
};

const serializeStreamTranscribeRequest = (data: Buffer): Buffer => data;

const deserializeStreamTranscribeEvent = (
  data: Buffer,
): StreamTranscribeEventMessage => {
  try {
    return StreamTranscribeEvent.decode(data) as StreamTranscribeEventMessage;
  } catch (error) {
    throw new GrpcDictationError(
      `Failed to decode StreamTranscribeEvent: ${
        error instanceof Error ? error.message : String(error)
      }`,
      grpcStatusCode.INTERNAL,
    );
  }
};

const finalTranscriptFromEvent = (
  event: StreamTranscribeEventMessage,
): GrpcFinalTranscript | null => {
  if (!event.final) {
    return null;
  }

  return {
    rawTranscript: event.final.rawTranscript ?? "",
    formattedTranscript: event.final.formattedTranscript ?? "",
    throughSeq: toBigInt(event.final.throughSeq),
  };
};

const resolveRpcPath = (endpoint: URL): string => {
  const basePath = endpoint.pathname.endsWith("/")
    ? endpoint.pathname.slice(0, -1)
    : endpoint.pathname;
  return `${basePath}${STREAM_TRANSCRIBE_PATH}`;
};

const channelTargetForEndpoint = (endpoint: URL): string => {
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error(`Unsupported gRPC endpoint protocol: ${endpoint.protocol}`);
  }

  if (endpoint.protocol === "http:" && !endpoint.port) {
    return `${endpoint.hostname}:80`;
  }

  return endpoint.host;
};

const channelCredentialsForEndpoint = (endpoint: URL): ChannelCredentials =>
  endpoint.protocol === "https:"
    ? ChannelCredentials.createSsl()
    : ChannelCredentials.createInsecure();

const buildChannelOptions = (userAgent: string): ChannelOptions => ({
  "grpc.primary_user_agent": userAgent,
  "grpc.keepalive_time_ms": KEEPALIVE_TIME_MS,
  "grpc.keepalive_timeout_ms": KEEPALIVE_TIMEOUT_MS,
  "grpc.keepalive_permit_without_calls": 1,
  // grpc-js 1.14.x does not currently read these grpc.http2.* Core channel
  // args; keep them as no-op parity/documentation for Core-based clients.
  "grpc.http2.max_pings_without_data": 0,
  "grpc.http2.min_time_between_pings_ms": 5000,
  "grpc.http2.min_ping_interval_without_data_ms": 5000,
  "grpc.max_send_message_length": MAX_GRPC_MESSAGE_BYTES,
  "grpc.max_receive_message_length": MAX_GRPC_MESSAGE_BYTES,
  "grpc.initial_reconnect_backoff_ms": 1000,
  "grpc.max_reconnect_backoff_ms": 10000,
});

const buildCallMetadata = (options: GrpcDictationStreamOptions): Metadata => {
  const metadata = new Metadata();
  metadata.set(AUTHORIZATION_HEADER, `Bearer ${options.token}`);
  metadata.set(AMICAL_CLIENT_HEADER, options.clientInfo.client);
  metadata.set(AMICAL_VERSION_HEADER, options.clientInfo.version);
  metadata.set(AMICAL_PLATFORM_HEADER, options.clientInfo.platform);
  const labsHeader = buildAmicalLabsHeader(options.labs ?? []);
  if (labsHeader) {
    metadata.set(AMICAL_LABS_HEADER, labsHeader);
  }
  return metadata;
};

const isServiceError = (error: unknown): error is ServiceError =>
  error instanceof Error && typeof (error as ServiceError).code === "number";

const extractHttpStatusFromGrpcJsDetails = (
  details: string | undefined,
): number | undefined => {
  const status = details?.match(GRPC_JS_HTTP_STATUS_DETAILS_PATTERN)?.groups
    ?.status;
  if (!status) {
    return undefined;
  }

  const httpStatus = Number(status);
  return Number.isInteger(httpStatus) ? httpStatus : undefined;
};

interface GrpcStreamState {
  settled: boolean;
  cancelled: boolean;
  finalizeSent: boolean;
  terminalError: Error | null;
  grpcStatus: number | undefined;
  grpcMessage: string | undefined;
  traceId: string | undefined;
  pendingFinalTranscript: GrpcFinalTranscript | null;
  responseEnded: boolean;
  clientClosed: boolean;
}

type CancelDecision =
  | { shouldCancel: false }
  | { shouldCancel: true; error: GrpcDictationError };

const createInitialGrpcStreamState = (): GrpcStreamState => ({
  settled: false,
  cancelled: false,
  finalizeSent: false,
  terminalError: null,
  grpcStatus: undefined,
  grpcMessage: undefined,
  traceId: undefined,
  pendingFinalTranscript: null,
  responseEnded: false,
  clientClosed: false,
});

export class CloudDictationGrpcStream {
  static readonly PACKET_SAMPLES = 512;
  static readonly PACKET_DURATION_MS = 32;

  private readonly client: Client;
  private readonly stream: ClientDuplexStream<
    Buffer,
    StreamTranscribeEventMessage
  >;
  private readonly finalDeferred: Deferred.Deferred<GrpcFinalTranscript, Error>;
  private readonly stateRef: Ref.Ref<GrpcStreamState>;
  private backgroundTail: Promise<void> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;

  readonly finalTranscript: Promise<GrpcFinalTranscript>;

  constructor(options: GrpcDictationStreamOptions) {
    this.finalDeferred = Effect.runSync(
      Deferred.make<GrpcFinalTranscript, Error>(),
    );
    this.stateRef = Effect.runSync(Ref.make(createInitialGrpcStreamState()));
    this.finalTranscript = runEffectPromise(Deferred.await(this.finalDeferred));
    this.finalTranscript.catch(() => undefined);

    const endpoint = new URL(options.endpoint);

    this.client = new Client(
      channelTargetForEndpoint(endpoint),
      channelCredentialsForEndpoint(endpoint),
      buildChannelOptions(options.userAgent),
    );

    this.stream = this.client.makeBidiStreamRequest<
      Buffer,
      StreamTranscribeEventMessage
    >(
      resolveRpcPath(endpoint),
      serializeStreamTranscribeRequest,
      deserializeStreamTranscribeEvent,
      buildCallMetadata(options),
      {
        deadline: new Date(Date.now() + STREAM_DEADLINE_MS),
      },
    );

    this.stream.on("metadata", (metadata) =>
      this.runBackground(this.updateTraceIdEffect(metadata)),
    );
    this.stream.on("data", (event) =>
      this.runBackground(this.handleDataEffect(event)),
    );
    this.stream.on("end", () =>
      this.runBackground(this.handleResponseEndEffect()),
    );
    this.stream.on("status", (streamStatus) =>
      this.runBackground(this.handleGrpcStatusEffect(streamStatus)),
    );
    this.stream.on("error", (error) => {
      this.runBackground(this.handleErrorEffect(error));
    });
    this.stream.on("close", () => this.runBackground(this.handleCloseEffect()));

    runEffectSync(this.writeRequestNowEffect(encodeOpenRequest(options)));
    if (options.context) {
      runEffectSync(
        this.writeRequestNowEffect(encodeContextUpdateRequest(options.context)),
      );
    }
    if (options.resolvedSkills && options.resolvedSkills.length > 0) {
      logger.transcription.debug("gRPC sending initial resolved skills", {
        sessionId: options.sessionId,
        count: options.resolvedSkills.length,
        skills: summarizeSkillsForLog(options.resolvedSkills),
      });
      runEffectSync(
        this.writeRequestNowEffect(
          encodeSkillsUpdateRequest(options.resolvedSkills),
        ),
      );
    } else {
      logger.transcription.debug("gRPC sending no resolved skills update", {
        sessionId: options.sessionId,
      });
    }

    this.scheduleIdleTimeout();
  }

  async sendAudioBatch(firstSeq: bigint, chunks: Uint8Array[]): Promise<void> {
    this.scheduleIdleTimeout();
    await runEffectPromise(
      this.writeRequestEffect(encodeAudioBatchRequest(firstSeq, chunks)),
    );
  }

  // Full snapshot replacement of the active stream context.
  async sendContextUpdate(context: GrpcStreamContext): Promise<void> {
    logger.transcription.debug("gRPC sending context update", {
      appType: context.appType,
      appBundleId: context.appBundleId,
      appName: context.appName,
      hasSelectedText: !!context.selectedText,
      hasBeforeText: context.beforeText !== undefined,
      hasAfterText: context.afterText !== undefined,
    });
    await runEffectPromise(
      this.writeRequestEffect(encodeContextUpdateRequest(context)),
    );
  }

  // Full snapshot replacement of the active skill set. Pass `[]` to clear
  // the active skills. Safe to call any time before finalize.
  async sendSkillsUpdate(skills: DictationSkill[]): Promise<void> {
    logger.transcription.debug("gRPC sending resolved skills update", {
      count: skills.length,
      skills: summarizeSkillsForLog(skills),
    });
    await runEffectPromise(
      this.writeRequestEffect(encodeSkillsUpdateRequest(skills)),
    );
  }

  async finalize(): Promise<GrpcFinalTranscript> {
    this.clearIdleTimeout();
    return await runEffectPromise(
      Effect.gen(this, function* () {
        const alreadyFinalized = yield* Ref.modify(this.stateRef, (state) =>
          state.finalizeSent
            ? ([true, state] as const)
            : ([false, { ...state, finalizeSent: true }] as const),
        );
        if (alreadyFinalized) {
          return yield* Deferred.await(this.finalDeferred);
        }

        yield* this.writeRequestEffect(encodeFinalizeRequest());
        yield* Effect.sync(() => this.stream.end());
        return yield* Deferred.await(this.finalDeferred);
      }),
    );
  }

  cancel(): void {
    this.clearIdleTimeout();
    this.runBackground(this.cancelEffect());
  }

  private scheduleIdleTimeout(): void {
    this.clearIdleTimeout();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.runBackground(
        this.failEffect(
          new GrpcDictationError(
            `gRPC stream idle for ${IDLE_TIMEOUT_MS}ms; closing as defense-in-depth`,
            grpcStatusCode.CANCELLED,
            undefined,
            undefined,
            true,
          ),
          true,
        ),
      );
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimeout(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private runBackground(effect: Effect.Effect<void, Error>): void {
    const run = async () => {
      try {
        await runEffectPromise(effect);
      } catch (error) {
        await runEffectPromise(this.failEffect(error)).catch(() => undefined);
      }
    };

    this.backgroundTail = this.backgroundTail.then(run, run);
    void this.backgroundTail.catch(() => undefined);
  }

  private writeRequestNowEffect(message: Buffer): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      yield* this.ensureWritableEffect();
      yield* Effect.try({
        try: () => {
          this.stream.write(message);
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });
      yield* this.failIfTerminalErrorEffect();
    });
  }

  private writeRequestEffect(message: Buffer): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      yield* this.ensureWritableEffect();
      yield* Effect.async<void, Error>((resume) => {
        let completed = false;

        const cleanup = () => {
          this.stream.off("close", onClose);
          this.stream.off("error", onError);
        };

        const finishWithEffect = (effect: Effect.Effect<void, Error>) => {
          if (completed) {
            return;
          }

          completed = true;
          cleanup();
          resume(effect);
        };

        const failWith = (errorEffect: Effect.Effect<Error>) =>
          finishWithEffect(errorEffect.pipe(Effect.flatMap(Effect.fail)));

        const onClose = () => {
          failWith(this.writeClosedErrorEffect());
        };
        const onError = (error: Error) => {
          failWith(this.normalizeGrpcErrorEffect(error));
        };

        this.stream.once("close", onClose);
        this.stream.once("error", onError);

        try {
          this.stream.write(message, (error?: Error | null) => {
            if (error) {
              failWith(this.normalizeGrpcErrorEffect(error));
              return;
            }
            finishWithEffect(Effect.void);
          });
        } catch (error) {
          failWith(this.normalizeGrpcErrorEffect(error));
        }

        return Effect.sync(cleanup);
      });
      yield* this.failIfTerminalErrorEffect();
    });
  }

  private cancelEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const decision = yield* Ref.modify(
        this.stateRef,
        (state): readonly [CancelDecision, GrpcStreamState] => {
          if (state.cancelled || state.settled) {
            return [{ shouldCancel: false }, state] as const;
          }

          const error = new GrpcDictationError(
            "gRPC stream cancelled",
            grpcStatusCode.CANCELLED,
            undefined,
            state.traceId,
          );

          return [
            { shouldCancel: true, error },
            {
              ...state,
              cancelled: true,
              settled: true,
              terminalError: error,
            },
          ] as const;
        },
      );

      if (!decision.shouldCancel) {
        return;
      }

      yield* Deferred.fail(this.finalDeferred, decision.error);
      yield* this.writeCancelFrameEffect();
      yield* this.scheduleCloseAfterCancelEffect();
    });
  }

  private writeCancelFrameEffect(): Effect.Effect<void> {
    return Effect.async<void>((resume) => {
      let completed = false;
      const finish = () => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeout);
        resume(Effect.void);
      };

      const endStream = () => {
        try {
          if (this.isStreamWritable()) {
            this.stream.end();
          }
        } catch {
          if (!this.stream.destroyed) {
            this.stream.cancel();
          }
        }
      };

      const timeout = setTimeout(() => {
        endStream();
        finish();
      }, CANCEL_FRAME_FLUSH_TIMEOUT_MS);
      timeout.unref?.();

      try {
        if (this.isStreamWritable()) {
          this.stream.write(encodeCancelRequest(), (error?: Error | null) => {
            if (error && !this.stream.destroyed) {
              this.stream.cancel();
            } else {
              endStream();
            }
            finish();
          });
        } else if (!this.stream.destroyed) {
          this.stream.cancel();
          finish();
        } else {
          finish();
        }
      } catch {
        if (!this.stream.destroyed) {
          this.stream.cancel();
        }
        finish();
      }

      return Effect.sync(() => {
        clearTimeout(timeout);
      });
    });
  }

  private scheduleCloseAfterCancelEffect(): Effect.Effect<void> {
    return Effect.sync(() => {
      // After the cancel frame has been written or timed out, leave a short
      // grace period for the half-close to reach the server before closing the
      // channel. This is best-effort because grpc-js exposes no drain signal.
      const closeTimer = setTimeout(() => {
        this.runBackground(this.closeClientEffect());
      }, CANCEL_FRAME_FLUSH_TIMEOUT_MS);
      closeTimer.unref?.();
    });
  }

  private handleDataEffect(
    event: StreamTranscribeEventMessage,
  ): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      const finalTranscript = yield* Effect.try({
        try: () => finalTranscriptFromEvent(event),
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });

      if (finalTranscript) {
        yield* Ref.update(this.stateRef, (state) => ({
          ...state,
          pendingFinalTranscript: finalTranscript,
        }));
        yield* this.resolveFinalIfOkEffect();
      }
    });
  }

  private handleResponseEndEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      yield* Ref.update(this.stateRef, (state) => ({
        ...state,
        responseEnded: true,
      }));
      yield* this.resolveFinalIfOkEffect();
      yield* this.failIfFinishedWithoutTranscriptEffect();
    });
  }

  private handleGrpcStatusEffect(
    streamStatus: StatusObject,
  ): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      yield* this.updateTraceIdEffect(streamStatus.metadata);
      yield* Ref.update(this.stateRef, (state) => ({
        ...state,
        grpcStatus: streamStatus.code,
        grpcMessage: streamStatus.details,
      }));

      if (streamStatus.code !== grpcStatusCode.OK) {
        const state = yield* Ref.get(this.stateRef);
        if (!state.cancelled) {
          const httpStatus = extractHttpStatusFromGrpcJsDetails(
            streamStatus.details,
          );
          yield* this.failEffect(
            new GrpcDictationError(
              streamStatus.details ||
                `gRPC stream failed with status ${streamStatus.code}`,
              streamStatus.code,
              httpStatus,
              state.traceId,
            ),
            false,
          );
        }
        return;
      }

      yield* this.resolveFinalIfOkEffect();
      yield* this.failIfFinishedWithoutTranscriptEffect();
    });
  }

  private failIfFinishedWithoutTranscriptEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.stateRef);
      if (
        !state.responseEnded ||
        state.grpcStatus !== grpcStatusCode.OK ||
        state.pendingFinalTranscript ||
        state.settled ||
        state.terminalError
      ) {
        return;
      }

      yield* this.failEffect(
        new GrpcDictationError(
          "gRPC stream closed before final transcript",
          state.grpcStatus,
          undefined,
          state.traceId,
        ),
        false,
      );
    });
  }

  private handleErrorEffect(error: Error): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.stateRef);
      if (!state.cancelled) {
        yield* this.failEffect(error, false);
      }
    });
  }

  private handleCloseEffect(): Effect.Effect<void> {
    return Effect.sync(() => {
      // grpc-js can emit close before status. Wait briefly so a delayed status
      // event can settle the stream before we synthesize a missing-status error.
      const closeStatusTimer = setTimeout(() => {
        this.runBackground(this.failIfClosedBeforeStatusEffect());
      }, CLOSE_STATUS_GRACE_MS);
      closeStatusTimer.unref?.();
    });
  }

  private failIfClosedBeforeStatusEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.stateRef);
      if (state.cancelled || state.settled || state.terminalError) {
        return;
      }

      const message = state.grpcMessage
        ? state.grpcMessage
        : state.pendingFinalTranscript
          ? "gRPC stream closed before OK status"
          : "gRPC stream closed before final transcript";

      yield* this.failEffect(
        new GrpcDictationError(
          message,
          state.grpcStatus,
          undefined,
          state.traceId,
        ),
        false,
      );
    });
  }

  private updateTraceIdEffect(
    metadata: Metadata | undefined,
  ): Effect.Effect<void> {
    const traceId = getFirstMetadataString(metadata, TRACE_ID_HEADER);
    if (!traceId) {
      return Effect.void;
    }

    return Ref.update(this.stateRef, (state) => ({
      ...state,
      traceId,
    }));
  }

  private isStreamWritable(): boolean {
    return !this.stream.destroyed && !this.stream.writableEnded;
  }

  private ensureWritableEffect(): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.stateRef);
      if (state.terminalError) {
        return yield* Effect.fail(state.terminalError);
      }

      if (state.settled || !this.isStreamWritable()) {
        return yield* Effect.fail(
          new GrpcDictationError(
            "gRPC stream is closed",
            state.grpcStatus,
            undefined,
            state.traceId,
          ),
        );
      }
    });
  }

  private failIfTerminalErrorEffect(): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.stateRef);
      if (state.terminalError) {
        return yield* Effect.fail(state.terminalError);
      }
    });
  }

  private writeClosedErrorEffect(): Effect.Effect<Error> {
    return Effect.gen(this, function* () {
      const state = yield* Ref.get(this.stateRef);
      return (
        state.terminalError ??
        new GrpcDictationError(
          "gRPC stream closed before write completed",
          state.grpcStatus,
          undefined,
          state.traceId,
        )
      );
    });
  }

  private normalizeGrpcErrorEffect(error: unknown): Effect.Effect<Error> {
    if (error instanceof GrpcDictationError) {
      return Effect.succeed(error);
    }

    if (isServiceError(error)) {
      return Effect.gen(this, function* () {
        yield* this.updateTraceIdEffect(error.metadata);
        const state = yield* Ref.get(this.stateRef);
        const httpStatus =
          extractHttpStatusFromGrpcJsDetails(error.details) ??
          extractHttpStatusFromGrpcJsDetails(error.message);
        return new GrpcDictationError(
          error.details ||
            error.message ||
            `gRPC stream failed with status ${error.code}`,
          error.code,
          httpStatus,
          state.traceId,
        );
      });
    }

    return Effect.succeed(
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  private resolveFinalIfOkEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const finalTranscript = yield* Ref.modify(this.stateRef, (state) => {
        if (
          state.settled ||
          state.terminalError ||
          state.grpcStatus !== grpcStatusCode.OK ||
          !state.pendingFinalTranscript
        ) {
          return [null, state] as const;
        }

        return [
          state.pendingFinalTranscript,
          {
            ...state,
            settled: true,
          },
        ] as const;
      });

      if (!finalTranscript) {
        return;
      }

      yield* Deferred.succeed(this.finalDeferred, finalTranscript);
      yield* this.closeClientEffect();
    });
  }

  private failEffect(error: unknown, cancelStream = true): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const normalized = yield* this.normalizeGrpcErrorEffect(error);
      const didSettle = yield* Ref.modify(this.stateRef, (state) => {
        if (state.settled || state.terminalError) {
          return [false, state] as const;
        }

        return [
          true,
          {
            ...state,
            settled: true,
            terminalError: normalized,
          },
        ] as const;
      });

      if (!didSettle) {
        return;
      }

      yield* Deferred.fail(this.finalDeferred, normalized);

      if (cancelStream && !this.stream.destroyed) {
        yield* Effect.sync(() => this.stream.cancel());
      }

      yield* this.closeClientEffect();
    });
  }

  private closeClientEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const shouldClose = yield* Ref.modify(this.stateRef, (state) => {
        if (state.clientClosed) {
          return [false, state] as const;
        }

        return [true, { ...state, clientClosed: true }] as const;
      });

      if (shouldClose) {
        yield* Effect.sync(() => {
          this.clearIdleTimeout();
          this.client.close();
        });
      }
    });
  }
}

export const float32ToPcmS16le = (samples: Float32Array): Uint8Array => {
  const buffer = Buffer.alloc(samples.length * 2);

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const normalized = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;
    const int16 =
      normalized < 0
        ? Math.round(normalized * 32768)
        : Math.round(normalized * 32767);
    buffer.writeInt16LE(int16, index * 2);
  }

  return buffer;
};
