import {
  connect,
  type ClientHttp2Session,
  type ClientHttp2Stream,
} from "node:http2";
import {
  AudioEncoding,
  Language,
  STREAM_TRANSCRIBE_PATH,
  StreamCancelCode,
  StreamTranscribeEvent,
  StreamTranscribeRequest,
} from "./gen/amical/dictation/v1/dictation";

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
  sessionId: string;
  language?: string;
  vocabulary: string[];
  formatting: boolean;
  context?: GrpcStreamContext;
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
  ) {
    super(message);
    this.name = "GrpcDictationError";
  }
}

const TRACE_ID_HEADER = "x-trace-id";

const extractTraceId = (
  headers: NodeJS.Dict<unknown> | undefined,
): string | undefined => {
  if (!headers) {
    return undefined;
  }
  const raw = headers[TRACE_ID_HEADER] as string | string[] | undefined;
  return getFirstHeader(raw);
};

export const GRPC_STATUS_PERMISSION_DENIED = 7;
export const GRPC_STATUS_RESOURCE_EXHAUSTED = 8;
export const GRPC_STATUS_UNAUTHENTICATED = 16;

const getFirstHeader = (
  value: number | string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "undefined" ? undefined : String(value);
};

const decodeGrpcMessage = (message: string | undefined): string => {
  if (!message) {
    return "";
  }

  try {
    return decodeURIComponent(message);
  } catch {
    return message;
  }
};

const httpStatusToGrpcStatus = (httpStatus: number): number | undefined => {
  switch (httpStatus) {
    case 401:
      return GRPC_STATUS_UNAUTHENTICATED;
    case 403:
      return GRPC_STATUS_PERMISSION_DENIED;
    case 429:
      return GRPC_STATUS_RESOURCE_EXHAUSTED;
    default:
      return undefined;
  }
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

class GrpcFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Uint8Array[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: Uint8Array[] = [];

    while (this.buffer.length >= 5) {
      const compressed = this.buffer[0];
      const length = this.buffer.readUInt32BE(1);
      if (this.buffer.length < 5 + length) {
        break;
      }

      if (compressed !== 0) {
        throw new Error("Compressed gRPC messages are not supported");
      }

      messages.push(this.buffer.subarray(5, 5 + length));
      this.buffer = this.buffer.subarray(5 + length);
    }

    return messages;
  }
}

const encodeGrpcFrame = (message: Uint8Array): Buffer => {
  const frame = Buffer.alloc(5 + message.length);
  frame[0] = 0;
  frame.writeUInt32BE(message.length, 1);
  Buffer.from(message).copy(frame, 5);
  return frame;
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

const buildLanguageConfig = (language?: string) => {
  const languageEnum = languageEnumForCode(language);

  if (!languageEnum) {
    return { auto: {} };
  }

  return {
    languages: {
      items: [languageEnum],
    },
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
      language: buildLanguageConfig(options.language),
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

const decodeStreamTranscribeEvent = (
  data: Uint8Array,
): GrpcFinalTranscript | null => {
  const event = StreamTranscribeEvent.decode(
    data,
  ) as StreamTranscribeEventMessage;
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

export class CloudDictationGrpcStream {
  static readonly PACKET_SAMPLES = 512;
  static readonly PACKET_DURATION_MS = 32;

  private readonly client: ClientHttp2Session;
  private readonly stream: ClientHttp2Stream;
  private readonly frameDecoder = new GrpcFrameDecoder();
  private readonly finalDeferred = createDeferred<GrpcFinalTranscript>();
  private settled = false;
  private cancelled = false;
  private terminalError: Error | null = null;
  private grpcStatus: number | undefined;
  private grpcMessage: string | undefined;
  private traceId: string | undefined;
  private pendingFinalTranscript: GrpcFinalTranscript | null = null;

  readonly finalTranscript = this.finalDeferred.promise;

  constructor(options: GrpcDictationStreamOptions) {
    this.finalTranscript.catch(() => undefined);

    const endpoint = new URL(options.endpoint);
    const origin = `${endpoint.protocol}//${endpoint.host}`;

    this.client = connect(origin);
    this.client.on("error", (error) => this.fail(error));

    this.stream = this.client.request({
      ":method": "POST",
      ":path": resolveRpcPath(endpoint),
      "content-type": "application/grpc+proto",
      te: "trailers",
      authorization: `Bearer ${options.token}`,
      "user-agent": options.userAgent,
      "x-platform": process.platform,
    });

    this.stream.on("response", (headers) => {
      const traceId = extractTraceId(headers);
      if (traceId) {
        this.traceId = traceId;
      }

      const httpStatus = Number(getFirstHeader(headers[":status"]));
      const grpcStatus = getFirstHeader(headers["grpc-status"]);
      if (Number.isFinite(httpStatus) && httpStatus >= 400) {
        this.fail(
          new GrpcDictationError(
            `gRPC HTTP error: ${httpStatus}`,
            httpStatusToGrpcStatus(httpStatus),
            httpStatus,
            this.traceId,
          ),
        );
        return;
      }

      if (typeof grpcStatus !== "undefined") {
        this.handleGrpcStatus(headers);
      }
    });
    this.stream.on("trailers", (headers) => this.handleGrpcStatus(headers));
    this.stream.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.stream.on("error", (error) => this.fail(error));
    this.stream.on("close", () => {
      if (!this.cancelled && !this.settled && !this.terminalError) {
        const message = this.grpcMessage
          ? this.grpcMessage
          : this.pendingFinalTranscript
            ? "gRPC stream closed before OK status"
            : "gRPC stream closed before final transcript";
        this.fail(
          new GrpcDictationError(
            message,
            this.grpcStatus,
            undefined,
            this.traceId,
          ),
        );
      }
      this.client.close();
    });

    this.writeFrameSync(encodeOpenRequest(options));
    if (options.context) {
      this.writeFrameSync(encodeContextUpdateRequest(options.context));
    }
  }

  async sendAudioBatch(firstSeq: bigint, chunks: Uint8Array[]): Promise<void> {
    await this.writeFrame(encodeAudioBatchRequest(firstSeq, chunks));
  }

  async finalize(): Promise<GrpcFinalTranscript> {
    await this.writeFrame(encodeFinalizeRequest());
    this.stream.end();
    return this.finalTranscript;
  }

  cancel(): void {
    if (this.cancelled || this.settled) {
      return;
    }

    this.cancelled = true;
    try {
      if (!this.stream.destroyed && !this.stream.closed) {
        this.writeFrameSync(encodeCancelRequest());
        this.stream.close();
      }
    } catch {
      this.stream.destroy();
    } finally {
      this.client.close();
    }
  }

  private writeFrameSync(message: Uint8Array): void {
    if (this.terminalError) {
      throw this.terminalError;
    }
    if (this.stream.destroyed || this.stream.closed) {
      throw new GrpcDictationError("gRPC stream is closed");
    }

    this.stream.write(encodeGrpcFrame(message));
  }

  private async writeFrame(message: Uint8Array): Promise<void> {
    if (this.terminalError) {
      throw this.terminalError;
    }
    if (this.stream.destroyed || this.stream.closed) {
      throw new GrpcDictationError("gRPC stream is closed");
    }

    const didFlush = this.stream.write(encodeGrpcFrame(message));
    if (!didFlush) {
      await this.waitForDrain();
    }

    if (this.terminalError) {
      throw this.terminalError;
    }
  }

  private waitForDrain(): Promise<void> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }
    if (this.stream.destroyed || this.stream.closed) {
      return Promise.reject(
        this.terminalError ??
          new GrpcDictationError(
            "gRPC stream closed before write drained",
            this.grpcStatus,
            undefined,
            this.traceId,
          ),
      );
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.stream.off("drain", onDrain);
        this.stream.off("close", onClose);
        this.stream.off("error", onError);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(
          this.terminalError ??
            new GrpcDictationError(
              "gRPC stream closed before write drained",
              this.grpcStatus,
              undefined,
              this.traceId,
            ),
        );
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.stream.once("drain", onDrain);
      this.stream.once("close", onClose);
      this.stream.once("error", onError);
    });
  }

  private handleData(chunk: Buffer): void {
    try {
      for (const message of this.frameDecoder.push(chunk)) {
        const finalTranscript = decodeStreamTranscribeEvent(message);
        if (finalTranscript) {
          this.pendingFinalTranscript = finalTranscript;
          this.resolveFinalIfOk();
        }
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private handleGrpcStatus(headers: NodeJS.Dict<unknown>): void {
    const traceId = extractTraceId(headers);
    if (traceId) {
      this.traceId = traceId;
    }

    const grpcStatusHeader = getFirstHeader(
      headers["grpc-status"] as string | string[] | undefined,
    );
    if (typeof grpcStatusHeader === "undefined") {
      return;
    }

    const grpcStatus = Number(grpcStatusHeader);
    this.grpcStatus = grpcStatus;
    this.grpcMessage = decodeGrpcMessage(
      getFirstHeader(headers["grpc-message"] as string | string[] | undefined),
    );

    if (grpcStatus !== 0) {
      this.fail(
        new GrpcDictationError(
          this.grpcMessage || `gRPC stream failed with status ${grpcStatus}`,
          grpcStatus,
          undefined,
          this.traceId,
        ),
      );
      return;
    }

    this.resolveFinalIfOk();
  }

  private resolveFinalIfOk(): void {
    if (
      this.settled ||
      this.terminalError ||
      this.grpcStatus !== 0 ||
      !this.pendingFinalTranscript
    ) {
      return;
    }

    this.settled = true;
    this.finalDeferred.resolve(this.pendingFinalTranscript);
  }

  private fail(error: unknown): void {
    if (this.settled && this.terminalError) {
      return;
    }

    const normalized =
      error instanceof Error ? error : new Error(String(error));
    this.terminalError = normalized;

    if (!this.settled) {
      this.settled = true;
      this.finalDeferred.reject(normalized);
    }

    if (!this.stream.destroyed) {
      this.stream.destroy();
    }
    this.client.close();
  }
}

export const float32ToPcmS16lePacket = (samples: Float32Array): Uint8Array => {
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
