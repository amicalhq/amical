import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

// ---- @grpc/grpc-js mock --------------------------------------------------

const grpcMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeMetadata {
    private readonly values = new Map<string, unknown[]>();
    set(key: string, value: unknown): void {
      this.values.set(key, [value]);
    }
    get(key: string): unknown[] {
      return this.values.get(key) ?? [];
    }
  }

  class FakeStream {
    private readonly handlers = new Map<string, Set<Handler>>();
    destroyed = false;
    writableEnded = false;
    write = vi.fn(
      (_message: Buffer, callback?: (error?: Error | null) => void) => {
        callback?.();
        return true;
      },
    );
    end = vi.fn(() => {
      this.writableEnded = true;
    });
    cancel = vi.fn(() => {
      this.destroyed = true;
      this.emit("close");
    });

    on(event: string, handler: Handler): this {
      const set = this.handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      this.handlers.set(event, set);
      return this;
    }
    once(event: string, handler: Handler): this {
      const wrapped: Handler = (...args) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }
    off(event: string, handler: Handler): this {
      this.handlers.get(event)?.delete(handler);
      return this;
    }
    emit(event: string, ...args: unknown[]): boolean {
      const list = [...(this.handlers.get(event) ?? [])];
      for (const h of list) {
        h(...args);
      }
      return list.length > 0;
    }
  }

  let lastStream: FakeStream | null = null;
  let lastClient: FakeClient | null = null;
  let failNextBidiStream = false;

  class FakeClient {
    close = vi.fn();
    constructor() {
      lastClient = this;
    }
    makeBidiStreamRequest = vi.fn(() => {
      if (failNextBidiStream) {
        failNextBidiStream = false;
        throw new Error("stream construction failed");
      }
      lastStream = new FakeStream();
      return lastStream;
    });
  }

  const status = {
    OK: 0,
    CANCELLED: 1,
    UNKNOWN: 2,
    INVALID_ARGUMENT: 3,
    DEADLINE_EXCEEDED: 4,
    NOT_FOUND: 5,
    ALREADY_EXISTS: 6,
    PERMISSION_DENIED: 7,
    RESOURCE_EXHAUSTED: 8,
    FAILED_PRECONDITION: 9,
    INTERNAL: 13,
    UNAVAILABLE: 14,
    UNAUTHENTICATED: 16,
  };

  return {
    module: {
      ChannelCredentials: {
        createSsl: vi.fn(() => ({ secure: true })),
        createInsecure: vi.fn(() => ({ secure: false })),
      },
      Client: FakeClient,
      Metadata: FakeMetadata,
      status,
    },
    metadata: () => new FakeMetadata(),
    status,
    getLastStream: () => lastStream,
    failNextStreamConstruction: () => {
      failNextBidiStream = true;
    },
    getLastClient: () => lastClient,
    reset: () => {
      lastStream = null;
      lastClient = null;
      failNextBidiStream = false;
    },
  };
});

vi.mock("@grpc/grpc-js", () => grpcMock.module);

// ---- AuthService mock ----------------------------------------------------

const authMock = vi.hoisted(() => {
  const isAuthenticated = vi.fn(async () => true);
  const getIdToken = vi.fn(async () => "test-id-token");
  const refreshTokenIfNeeded = vi.fn(async () => undefined);
  return {
    instance: { isAuthenticated, getIdToken, refreshTokenIfNeeded },
    reset: () => {
      isAuthenticated.mockReset();
      isAuthenticated.mockResolvedValue(true);
      getIdToken.mockReset();
      getIdToken.mockResolvedValue("test-id-token");
      refreshTokenIfNeeded.mockReset();
      refreshTokenIfNeeded.mockResolvedValue(undefined);
    },
  };
});

vi.mock("../../src/services/auth-service", () => ({
  AuthService: { getInstance: () => authMock.instance },
}));

vi.mock("../../src/utils/http-client", () => ({
  AMICAL_LAB_SELF_CORRECTION: "self-correction",
  AMICAL_LABS_HEADER: "amical-labs",
  AMICAL_CLIENT_HEADER: "amical-client",
  AMICAL_VERSION_HEADER: "amical-version",
  AMICAL_PLATFORM_HEADER: "amical-platform",
  buildAmicalLabsHeader: (labs: readonly string[]) => labs.join(","),
  getAmicalClientHeaders: () => ({
    "amical-client": "desktop",
    "amical-version": "0.0.0-test",
    "amical-platform": "test-platform",
  }),
  getAmicalClientInfo: () => ({
    client: "desktop",
    version: "0.0.0-test",
    platform: "test-platform",
  }),
  getUserAgent: () => "test-agent",
}));

vi.mock("../../src/main/logger", () => ({
  logger: {
    transcription: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// ---- Imports come AFTER mocks -------------------------------------------

import { AmicalCloudProvider } from "../../src/pipeline/providers/transcription/amical-cloud-provider";
import { GrpcDictationError } from "../../src/pipeline/providers/transcription/grpc-dictation-client";
import { AppError, ErrorCodes } from "../../src/types/error";
import type { TranscribeContext } from "../../src/pipeline/core/pipeline-types";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";

// ---- Helpers ------------------------------------------------------------

const flush = () => new Promise((r) => setImmediate(r));

const constructProviderWithTransport = (transport: "grpc" | "http") => {
  process.env.CLOUD_DICTATION_TRANSPORT = transport;
  return new AmicalCloudProvider();
};

const baseContext = (
  overrides: Partial<TranscribeContext> = {},
): TranscribeContext => ({
  sessionId: "session-1",
  vocabulary: [],
  accessibilityContext: null,
  previousChunk: undefined,
  aggregatedTranscription: undefined,
  languages: [],
  formattingEnabled: false,
  ...overrides,
});

const audioFrame = (samples = 512, fill = 0.1): Float32Array => {
  const a = new Float32Array(samples);
  a.fill(fill);
  return a;
};

const settleGrpcOk = (
  rawTranscript: string,
  formattedTranscript = rawTranscript,
  throughSeq = "1",
) => {
  const stream = grpcMock.getLastStream();
  if (!stream) throw new Error("No grpc stream constructed");
  stream.emit("data", {
    final: { rawTranscript, formattedTranscript, throughSeq },
  });
  stream.emit("status", {
    code: grpcMock.status.OK,
    details: "OK",
    metadata: grpcMock.metadata(),
  });
};

const settleGrpcError = (code: number, details = "") => {
  const stream = grpcMock.getLastStream();
  if (!stream) throw new Error("No grpc stream constructed");
  stream.emit("status", {
    code,
    details,
    metadata: grpcMock.metadata(),
  });
};

const mockFetchOnce = (response: {
  status: number;
  ok?: boolean;
  json?: unknown;
}) => {
  const fetchMock = global.fetch as Mock;
  fetchMock.mockImplementationOnce(async () => ({
    status: response.status,
    ok: response.ok ?? response.status < 400,
    statusText: `HTTP ${response.status}`,
    json: async () => response.json,
  }));
};

let fetchMock: Mock;

// Decode the number of audio samples sent in an HTTP transcription request.
// Body audioData is base64 pcm_s16le → 2 bytes per sample.
const httpRequestSampleCount = (callIndex = 0): number => {
  const [, init] = fetchMock.mock.calls[callIndex]!;
  const body = JSON.parse(init.body as string);
  return Buffer.from(body.audioData as string, "base64").length / 2;
};

beforeEach(() => {
  vi.clearAllMocks();
  grpcMock.reset();
  authMock.reset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("__BUNDLED_API_ENDPOINT", "https://cloud.test");
  delete process.env.API_ENDPOINT;
  delete process.env.CLOUD_DICTATION_TRANSPORT;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- Tests ---------------------------------------------------------------

describe("AmicalCloudProvider", () => {
  describe("transport selection", () => {
    it("defaults to gRPC and constructs a grpc client on first transcribe", async () => {
      const provider = constructProviderWithTransport("grpc");
      const transcribe = provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await flush();
      expect(grpcMock.getLastClient()).not.toBeNull();
      // No HTTP fallback engaged → fetch never called.
      expect(fetchMock).not.toHaveBeenCalled();
      // Settle the deferred so the Promise resolves cleanly.
      // (Stream is opened and an audio packet was queued; settle to OK with empty transcript via flush)
      grpcMock.getLastStream()?.emit("end");
      const result = await transcribe;
      expect(result).toEqual({ text: "" });
    });

    it("uses HTTP path when CLOUD_DICTATION_TRANSPORT=http", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "hello world" },
      });
      // Buffer some audio so flush has something to send.
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const result = await provider.flush(baseContext());
      expect(result.text).toBe("hello world");
      expect(grpcMock.getLastClient()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("HTTP path body shape", () => {
    it('sends pcm_s16le base64 with audioFormat="pcm_s16le"', async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "hi" },
      });

      // Buffer enough audio so flush includes it.
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await provider.flush(baseContext());

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.audioFormat).toBe("pcm_s16le");
      expect(typeof body.audioData).toBe("string");
      // base64 of N int16 samples → ceil(2N / 3) * 4 chars.
      // Frame had 512 samples → 1024 bytes → 1368 chars (with padding).
      expect((body.audioData as string).length).toBeGreaterThan(1000);
    });

    it("omits audioFormat and sends empty audioData on format-only flush", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "Formatted!" },
      });

      // No transcribe() calls; flush with formatting + previous transcription forces the text-only path.
      await provider.flush(
        baseContext({
          formattingEnabled: true,
          aggregatedTranscription: "raw text",
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.audioData).toBe("");
      expect(body.audioFormat).toBeUndefined();
    });

    it("skips text-only final flush when formatting is off and no final skill applies", async () => {
      const provider = constructProviderWithTransport("http");

      const result = await provider.flush(
        baseContext({
          formattingEnabled: false,
          aggregatedTranscription: "raw text",
        }),
      );

      expect(result).toEqual({ text: "" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends text-only final flush for instruct even when formatting is off", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "Drafted!" },
      });

      await provider.flush(
        baseContext({
          formattingEnabled: false,
          aggregatedTranscription: "draft source",
          isInstruct: true,
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.audioData).toBe("");
      expect(body.audioFormat).toBeUndefined();
      expect(body.formatting).toEqual({ enabled: false });
      expect(body.previousTranscription).toBe("draft source");
      expect(body.skills).toEqual([{ preset: "instruct" }]);
    });

    it("sends explicit Amical client headers", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "hi" },
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await provider.flush(baseContext());

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers).toMatchObject({
        "User-Agent": "test-agent",
        "amical-client": "desktop",
        "amical-version": "0.0.0-test",
        "amical-platform": "test-platform",
      });
    });

    it("sends stackable labs header when self correction is enabled", async () => {
      process.env.CLOUD_DICTATION_TRANSPORT = "http";
      const settingsService = {
        getLabsSettings: vi.fn().mockResolvedValue({ selfCorrection: true }),
      } as unknown as SettingsService;
      const provider = new AmicalCloudProvider(null, settingsService);
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "hi" },
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await provider.flush(baseContext());

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers).toMatchObject({
        "amical-labs": "self-correction",
      });
    });
  });

  describe("HTTP error surfacing", () => {
    it("surfaces 500 as INTERNAL_SERVER_ERROR", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 500,
        json: { error: { code: undefined, message: "boom" } },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.INTERNAL_SERVER_ERROR,
        statusCode: 500,
      });
    });

    it("surfaces a thrown network error as NETWORK_ERROR", async () => {
      const provider = constructProviderWithTransport("http");
      fetchMock.mockImplementationOnce(async () => {
        throw new Error("ECONNREFUSED");
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
    });

    it("retries once on 401 with a refreshed token, then succeeds", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({ status: 401, json: { error: {} } });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "ok" },
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const result = await provider.flush(baseContext());

      expect(result.text).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalled();
    });

    it("surfaces AUTH_REQUIRED when token refresh fails after 401", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({ status: 401, json: { error: {} } });
      authMock.instance.refreshTokenIfNeeded.mockRejectedValueOnce(
        new Error("refresh failed"),
      );
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.AUTH_REQUIRED,
        statusCode: 401,
      });
    });
  });

  describe("gRPC error categorization (no fallback)", () => {
    const driveGrpcThenSettleError = async (errorCode: number) => {
      const provider = constructProviderWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();
      settleGrpcError(errorCode, "");
      return { provider, flushPromise };
    };

    it("surfaces UNAUTHENTICATED as AUTH_REQUIRED without falling back", async () => {
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.UNAUTHENTICATED,
      );
      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.AUTH_REQUIRED,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // RESOURCE_EXHAUSTED maps to QUOTA_EXCEEDED today (Upgrade CTA, 402).
    // The wire doesn't yet disambiguate plan-cap rejections from other
    // resource-exhausted causes; revisit once server-side trailers carry a
    // reason and split this test per-reason.
    it("surfaces RESOURCE_EXHAUSTED as QUOTA_EXCEEDED without falling back", async () => {
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.RESOURCE_EXHAUSTED,
      );
      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.QUOTA_EXCEEDED,
        statusCode: 402,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not fall back on CANCELLED (user-initiated, e.g. reset during flush)", async () => {
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.CANCELLED,
      );
      // Should surface the cancellation as a NETWORK_ERROR, not trigger an HTTP transcription.
      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
        statusCode: 499,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("gRPC → HTTP fallback", () => {
    const driveGrpcAndFallback = async (
      errorCode: number,
      httpResponse: { status: number; json: unknown },
      options: {
        provider?: AmicalCloudProvider;
        sessionId?: string;
      } = {},
    ) => {
      const provider =
        options.provider ?? constructProviderWithTransport("grpc");
      const sessionOverride = options.sessionId
        ? { sessionId: options.sessionId }
        : {};
      mockFetchOnce(httpResponse);
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(sessionOverride),
      });
      const grpcClient = grpcMock.getLastClient();
      const flushPromise = provider.flush(
        baseContext({
          ...sessionOverride,
          formattingEnabled: true,
          aggregatedTranscription: "earlier text",
        }),
      );
      await flush();
      settleGrpcError(errorCode, "");
      return { provider, result: await flushPromise, grpcClient };
    };

    it("falls back to HTTP on INTERNAL (server-side bug, may be gRPC-handler-specific)", async () => {
      const { result } = await driveGrpcAndFallback(grpcMock.status.INTERNAL, {
        status: 200,
        json: { success: true, transcription: "fallback worked" },
      });
      expect(result.text).toBe("fallback worked");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to HTTP on INVALID_ARGUMENT (proto/schema mismatch)", async () => {
      const { result } = await driveGrpcAndFallback(
        grpcMock.status.INVALID_ARGUMENT,
        {
          status: 200,
          json: { success: true, transcription: "via http" },
        },
      );
      expect(result.text).toBe("via http");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to HTTP on UNAVAILABLE and includes the audio streamed before the failure", async () => {
      const provider = constructProviderWithTransport("grpc");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "fallback with audio" },
      });

      // One chunk streamed over gRPC opens the stream and seeds the mirror.
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      const flushPromise = provider.flush(
        baseContext({
          formattingEnabled: true,
          aggregatedTranscription: "earlier text",
        }),
      );
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      const result = await flushPromise;

      expect(result.text).toBe("fallback with audio");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Post-fix: the single pre-failure frame is recovered, not dropped.
      const sampleCount = httpRequestSampleCount();
      expect(sampleCount).toBe(512);
    });

    it("a new session re-attempts gRPC after a previous session fell back to HTTP", async () => {
      const { provider, grpcClient: clientForSessionA } =
        await driveGrpcAndFallback(
          grpcMock.status.UNAVAILABLE,
          {
            status: 200,
            json: { success: true, transcription: "session-A http" },
          },
          { sessionId: "session-A" },
        );

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-B" }),
      });

      expect(grpcMock.getLastClient()).not.toBe(clientForSessionA);
      expect(grpcMock.getLastClient()).not.toBeNull();
      // Drain session B's gRPC deferred so the test doesn't leave it dangling.
      settleGrpcOk("");
      await provider.flush(baseContext({ sessionId: "session-B" }));
    });

    it("emits a cloud_grpc_fallback telemetry event when gRPC drops", async () => {
      const trackCloudGrpcFallback = vi.fn();
      const telemetryStub = {
        trackCloudGrpcFallback,
      } as unknown as TelemetryService;
      process.env.CLOUD_DICTATION_TRANSPORT = "grpc";

      await driveGrpcAndFallback(
        grpcMock.status.UNAVAILABLE,
        {
          status: 200,
          json: { success: true, transcription: "fallback worked" },
        },
        { provider: new AmicalCloudProvider(telemetryStub) },
      );

      expect(trackCloudGrpcFallback).toHaveBeenCalledTimes(1);
      expect(trackCloudGrpcFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          error_code: ErrorCodes.NETWORK_ERROR,
          status_code: 503,
          session_id: "session-1",
          fallback_stage: "flush",
        }),
      );
    });

    it("transport switch is sticky: subsequent calls go via HTTP without a new gRPC client", async () => {
      const provider = constructProviderWithTransport("grpc");

      // Open a gRPC stream then trigger fallback on flush.
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "first" },
      });
      const firstFlush = provider.flush(
        baseContext({
          formattingEnabled: true,
          aggregatedTranscription: "earlier text",
        }),
      );
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      await firstFlush;

      // After fallback engaged, no new gRPC client should be constructed.
      const clientAfterFirst = grpcMock.getLastClient();

      // Second call must now go via HTTP. Buffer audio + flush.
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "second" },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const second = await provider.flush(baseContext());

      expect(second.text).toBe("second");
      expect(grpcMock.getLastClient()).toBe(clientAfterFirst);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("HTTP fallback re-transcribes the full session audio buffered during gRPC", async () => {
      const provider = constructProviderWithTransport("grpc");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "full audio" },
      });

      // Three chunks streamed over gRPC: opens the stream and accumulates
      // the session mirror. Each transcribe returns "" (gRPC streams silently).
      for (let i = 0; i < 3; i++) {
        await provider.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        });
      }

      const flushPromise = provider.flush(baseContext());
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      const result = await flushPromise;

      expect(result.text).toBe("full audio");

      // The HTTP request must carry all three frames, not zero (pre-fix) or one.
      const sampleCount = httpRequestSampleCount();
      expect(sampleCount).toBe(3 * 512);
    });

    it("transcribe-stage fallback buffers the current chunk exactly once", async () => {
      const provider = constructProviderWithTransport("grpc");
      // Force gRPC stream construction to throw → fallback during transcribe().
      grpcMock.failNextStreamConstruction();

      // One short frame: below MIN_AUDIO_DURATION_MS, so the fallback route
      // does not transcribe yet (no HTTP request during transcribe).
      const chunk = await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      expect(chunk.text).toBe("");
      expect(fetchMock).not.toHaveBeenCalled();

      // Flush now runs over the HTTP transport and sends the buffered audio.
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "once" },
      });
      const result = await provider.flush(baseContext());

      expect(result.text).toBe("once");
      const sampleCount = httpRequestSampleCount();
      // Exactly one frame — not duplicated by the fallback route re-buffering.
      expect(sampleCount).toBe(512);
    });

    it("does not bleed a prior session's audio into a later fallback", async () => {
      const provider = constructProviderWithTransport("grpc");

      // Session A: stream two frames over gRPC and finish successfully.
      for (let i = 0; i < 2; i++) {
        await provider.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext({ sessionId: "session-A" }),
        });
      }
      const flushA = provider.flush(baseContext({ sessionId: "session-A" }));
      await flush();
      settleGrpcOk("session A text");
      await flushA;

      // Session B: stream one frame, then fall back to HTTP at flush.
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "session B http" },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-B" }),
      });
      const flushB = provider.flush(baseContext({ sessionId: "session-B" }));
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      const result = await flushB;

      expect(result.text).toBe("session B http");
      // Only session B's single frame — session A's two frames must be gone.
      const sampleCount = httpRequestSampleCount();
      expect(sampleCount).toBe(512);
    });

    it("reset() discards mirrored audio so it cannot leak into a later fallback", async () => {
      const provider = constructProviderWithTransport("grpc");

      // Stream two frames over gRPC, then cancel via reset().
      for (let i = 0; i < 2; i++) {
        await provider.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        });
      }
      provider.reset();

      // A fresh frame, then fall back to HTTP at flush.
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "after reset" },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      const result = await flushPromise;

      expect(result.text).toBe("after reset");
      const sampleCount = httpRequestSampleCount();
      // Only the post-reset frame; the two pre-reset frames are discarded.
      expect(sampleCount).toBe(512);
    });
  });

  describe("AppError passthrough", () => {
    it("AppError thrown internally is not double-wrapped", async () => {
      const provider = constructProviderWithTransport("http");
      authMock.instance.isAuthenticated.mockResolvedValueOnce(false);
      const promise = provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expect(promise).rejects.toBeInstanceOf(AppError);
      await expect(promise).rejects.toMatchObject({
        errorCode: ErrorCodes.AUTH_REQUIRED,
      });
    });
  });

  describe("idle timeout", () => {
    it("surfaces leaf idle-timeout as IDLE_TIMEOUT (not NETWORK_ERROR) and does not fall back to HTTP", async () => {
      const provider = constructProviderWithTransport("grpc");

      // Open a gRPC stream by transcribing once.
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      const stream = grpcMock.getLastStream()!;
      const flushPromise = provider.flush(baseContext());
      await flush();

      // Inject the same GrpcDictationError the leaf's idle timer would
      // synthesize. Going through the leaf's real timer would require
      // vi.useFakeTimers and 10s of advancement; the leaf already has
      // dedicated tests for that path.
      stream.emit(
        "error",
        new GrpcDictationError(
          "gRPC stream idle for 10000ms",
          grpcMock.status.CANCELLED,
          undefined,
          undefined,
          true,
        ),
      );

      await expect(flushPromise).rejects.toMatchObject({
        errorCode: "IDLE_TIMEOUT",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("warmup", () => {
    it("warmup() calls refreshTokenIfNeeded but does NOT open a gRPC stream", async () => {
      const provider = constructProviderWithTransport("grpc");
      await provider.warmup();
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledTimes(1);
      expect(grpcMock.getLastClient()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("reset / dispose", () => {
    it("reset() clears state and tears down the in-flight gRPC stream", async () => {
      const provider = constructProviderWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const stream = grpcMock.getLastStream()!;
      const writesBefore = stream.write.mock.calls.length;
      provider.reset();
      // CloudDictationGrpcStream.cancel() is fire-and-forget — the cancel frame
      // and end() run on the next microtask via runBackground.
      await flush();
      expect(stream.write.mock.calls.length).toBeGreaterThan(writesBefore);
      expect(stream.end).toHaveBeenCalled();
    });

    it("dispose() makes the runtime unusable for further calls", async () => {
      const provider = constructProviderWithTransport("http");
      await provider.dispose();
      // Any subsequent use should throw or reject.
      await expect(
        provider.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
      ).rejects.toBeDefined();
    });
  });

  describe("dismiss / abort wiring", () => {
    it("aborts the in-flight HTTP /transcribe request when the dismiss signal fires", async () => {
      const provider = constructProviderWithTransport("http");
      let capturedSignal: AbortSignal | undefined;
      // Real fetch rejects when its signal aborts; model that so the in-flight
      // request actually resolves on abort.
      fetchMock.mockImplementationOnce(
        (_url: unknown, init: { signal?: AbortSignal }) => {
          capturedSignal = init.signal;
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        },
      );

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const controller = new AbortController();
      const flushPromise = provider.flush(baseContext(), controller.signal);
      await flush(); // let the fetch start

      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal!.aborted).toBe(false);

      controller.abort(); // dismiss

      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
      // The /transcribe request itself was aborted (not left hanging).
      expect(capturedSignal!.aborted).toBe(true);
    });

    it("cancels the in-flight gRPC flush via reset() and does not fall back to HTTP", async () => {
      const provider = constructProviderWithTransport("grpc");
      const resetSpy = vi.spyOn(provider, "reset");

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const controller = new AbortController();
      const flushPromise = provider.flush(baseContext(), controller.signal);
      await flush();

      controller.abort(); // dismiss → reset() → stream.cancel()

      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
        statusCode: 499,
      });
      expect(resetSpy).toHaveBeenCalled();
      // A user-initiated cancel must NOT spawn a phantom HTTP fallback.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("scopes the abort signal to /transcribe only — auth calls carry no signal", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "ok" },
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const controller = new AbortController();
      await provider.flush(baseContext(), controller.signal);

      // The /transcribe fetch carried an abort signal...
      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as { signal?: AbortSignal }).signal).toBeInstanceOf(
        AbortSignal,
      );

      // ...but auth calls carry NONE. Aborting a dismiss must never cancel a
      // token refresh and drop a freshly-minted refresh token.
      expect(authMock.instance.getIdToken).toHaveBeenCalled();
      for (const call of authMock.instance.getIdToken.mock.calls) {
        expect(call).toHaveLength(0);
      }
      for (const call of authMock.instance.refreshTokenIfNeeded.mock.calls) {
        expect(call).toHaveLength(0);
      }
    });
  });
});
