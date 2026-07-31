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

const httpClientMock = vi.hoisted(() => ({ locale: "en" }));

vi.mock("@grpc/grpc-js", () => grpcMock.module);

// ---- AuthService mock ----------------------------------------------------

const authMock = vi.hoisted(() => {
  const isAuthenticated = vi.fn(async () => true);
  const getIdToken = vi.fn(async () => "test-id-token");
  const refreshTokenIfNeeded = vi
    .fn<(force?: boolean) => Promise<void>>()
    .mockResolvedValue(undefined);
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
    "Accept-Language": httpClientMock.locale,
  }),
  getAmicalClientInfo: () => ({
    client: "desktop",
    version: "0.0.0-test",
    platform: "test-platform",
    locale: httpClientMock.locale,
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
import { StreamTranscribeRequest } from "../../src/pipeline/providers/transcription/gen/amical/dictation/v1/dictation";
import {
  AppError,
  DictationErrorCodes,
  ErrorCodes,
} from "../../src/types/error";
import type { TranscribeContext } from "../../src/pipeline/core/pipeline-types";
import type { GetAccessibilityContextResult } from "@amical/types";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import type { AuthService } from "../../src/services/auth-service";

// ---- Helpers ------------------------------------------------------------

const flush = () => new Promise((r) => setImmediate(r));

const constructProviderWithTransport = (transport: "grpc" | "http") => {
  process.env.CLOUD_DICTATION_TRANSPORT = transport;
  return new AmicalCloudProvider(authMock.instance as unknown as AuthService);
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

const accessibilityContext = (
  bundleIdentifier: string,
): GetAccessibilityContextResult =>
  ({
    context: {
      application: {
        bundleIdentifier,
        name: "Discord",
      },
      textSelection: {
        selectedText: "",
        preSelectionText: "before",
        postSelectionText: "after",
      },
    },
  }) as unknown as GetAccessibilityContextResult;

const decodedGrpcWrites = () => {
  const stream = grpcMock.getLastStream();
  if (!stream) throw new Error("No grpc stream constructed");
  return stream.write.mock.calls.map(([message]) =>
    StreamTranscribeRequest.toObject(
      StreamTranscribeRequest.decode(message as Buffer),
    ),
  ) as Array<{
    open?: { sessionId?: string };
    contextUpdate?: {
      context?: {
        appBundleId?: string;
        appName?: string;
        beforeText?: string;
        afterText?: string;
      };
    };
    skillsUpdate?: {
      resolvedSkills?: Array<{ preset?: string }>;
    };
  }>;
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
const HTTP_AUTO_FLUSH_SAMPLES = 28 * 16_000;

const httpRequestBody = (callIndex = 0): Record<string, unknown> => {
  const [, init] = fetchMock.mock.calls[callIndex]!;
  return JSON.parse(init.body as string) as Record<string, unknown>;
};

// Decode the number of audio samples sent in an HTTP transcription request.
// Body audioData is base64 pcm_s16le → 2 bytes per sample.
const httpRequestSampleCount = (callIndex = 0): number => {
  const body = httpRequestBody(callIndex);
  return Buffer.from(body.audioData as string, "base64").length / 2;
};

beforeEach(() => {
  vi.clearAllMocks();
  grpcMock.reset();
  authMock.reset();
  httpClientMock.locale = "en";
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

  describe("gRPC live session updates", () => {
    it("sends late accessibility context to an open stream", async () => {
      const provider = constructProviderWithTransport("grpc");

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({
          formattingEnabled: false,
          accessibilityContext: null,
        }),
      });

      await provider.updateSessionContext({
        ...baseContext({
          formattingEnabled: false,
          accessibilityContext: accessibilityContext("com.hnc.Discord"),
        }),
      });

      const contextUpdates = decodedGrpcWrites().filter(
        (write) => write.contextUpdate,
      );
      expect(contextUpdates).toHaveLength(1);
      expect(contextUpdates[0]?.contextUpdate?.context).toMatchObject({
        appBundleId: "com.hnc.Discord",
        appName: "Discord",
        beforeText: "before",
        afterText: "after",
      });
    });

    it("sends instruct skills when draft state arrives after stream open", async () => {
      const provider = constructProviderWithTransport("grpc");

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({
          formattingEnabled: false,
          isInstruct: false,
        }),
      });

      await provider.updateSessionContext(
        baseContext({
          formattingEnabled: false,
          isInstruct: true,
        }),
      );

      const skillsUpdates = decodedGrpcWrites().filter(
        (write) => write.skillsUpdate,
      );
      expect(skillsUpdates).toHaveLength(1);
      expect(skillsUpdates[0]?.skillsUpdate?.resolvedSkills?.[0]?.preset).toBe(
        "instruct",
      );
    });

    it("sends context before skills and suppresses duplicate snapshots", async () => {
      const provider = constructProviderWithTransport("grpc");
      const liveContext = baseContext({
        formattingEnabled: false,
        accessibilityContext: accessibilityContext("com.hnc.Discord"),
        isInstruct: true,
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({
          formattingEnabled: false,
          accessibilityContext: null,
          isInstruct: false,
        }),
      });

      await provider.updateSessionContext(liveContext);
      const writesAfterFirstUpdate = decodedGrpcWrites();
      await provider.updateSessionContext(liveContext);

      expect(decodedGrpcWrites()).toHaveLength(writesAfterFirstUpdate.length);
      const updateCases = writesAfterFirstUpdate
        .map((write) =>
          write.contextUpdate
            ? "contextUpdate"
            : write.skillsUpdate
              ? "skillsUpdate"
              : null,
        )
        .filter((kind): kind is "contextUpdate" | "skillsUpdate" => !!kind);
      expect(updateCases).toEqual(["contextUpdate", "skillsUpdate"]);
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

    it("auto-flushes the whole buffer at 28 seconds without client VAD data", async () => {
      const provider = constructProviderWithTransport("http");

      // More than three seconds of silence used to trigger the client-VAD cut.
      for (let index = 0; index < 94; index++) {
        await provider.transcribe({
          audioData: audioFrame(),
          speechProbability: 0,
          context: baseContext(),
        });
      }
      expect(fetchMock).not.toHaveBeenCalled();

      const bufferedSamples = 94 * 512;
      await provider.transcribe({
        audioData: audioFrame(HTTP_AUTO_FLUSH_SAMPLES - bufferedSamples - 1),
        speechProbability: 0,
        context: baseContext(),
      });
      expect(fetchMock).not.toHaveBeenCalled();

      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "28 seconds" },
      });
      await expect(
        provider.transcribe({
          audioData: audioFrame(1),
          speechProbability: 0,
          context: baseContext(),
        }),
      ).resolves.toMatchObject({ text: "28 seconds" });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(httpRequestSampleCount()).toBe(HTTP_AUTO_FLUSH_SAMPLES);
      expect(httpRequestBody()).toMatchObject({ isFinal: false });
      expect(httpRequestBody()).not.toHaveProperty("vadProbs");

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 0,
        context: baseContext({ aggregatedTranscription: "28 seconds" }),
      });
      expect(fetchMock).toHaveBeenCalledOnce();
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

    it("sends a text-only final when prior text exists without formatting or skills", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "raw text" },
      });

      const result = await provider.flush(
        baseContext({
          formattingEnabled: false,
          aggregatedTranscription: "raw text",
        }),
      );

      expect(result).toMatchObject({ text: "raw text" });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(httpRequestBody()).toMatchObject({
        isFinal: true,
        audioData: "",
        previousTranscription: "raw text",
        formatting: { enabled: false },
      });
      expect(httpRequestBody()).not.toHaveProperty("audioFormat");
    });

    it("keeps a final with no audio and no prior text as a no-op", async () => {
      const provider = constructProviderWithTransport("http");

      await expect(provider.flush(baseContext())).resolves.toEqual({
        text: "",
      });
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
        "Accept-Language": "en",
      });
    });

    it("sends stackable labs header when self correction is enabled", async () => {
      process.env.CLOUD_DICTATION_TRANSPORT = "http";
      httpClientMock.locale = "ja";
      const settingsService = {
        getLabsSettings: vi.fn().mockResolvedValue({ selfCorrection: true }),
      } as unknown as SettingsService;
      const provider = new AmicalCloudProvider(
        authMock.instance as unknown as AuthService,
        null,
        settingsService,
      );
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
        "Accept-Language": "ja",
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
        message: "boom",
        errorCode: ErrorCodes.INTERNAL_SERVER_ERROR,
        httpStatus: 500,
        uiMessage: undefined,
      });
    });

    it("uses only localizedMessage as the user-facing HTTP override", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 402,
        json: {
          error: {
            code: "QUOTA_EXCEEDED",
            message: "The account has exhausted its dictation quota.",
            localizedMessage: {
              locale: "de",
              message: "Du hast dein Transkriptionslimit erreicht.",
            },
            traceId: "trace-http",
          },
        },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        message: "The account has exhausted its dictation quota.",
        errorCode: ErrorCodes.QUOTA_EXCEEDED,
        applicationCode: DictationErrorCodes.QUOTA_EXCEEDED,
        httpStatus: 402,
        uiMessage: "Du hast dein Transkriptionslimit erreicht.",
        traceId: "trace-http",
      });
    });

    it("maps a validated FORBIDDEN code independently of its HTTP status", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 403,
        json: {
          error: {
            code: "FORBIDDEN",
            message: "Cloud transcription access denied.",
            localizedMessage: {
              locale: "de",
              message: "Du hast keinen Zugriff auf die Cloud-Transkription.",
            },
          },
        },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.INTERNAL_SERVER_ERROR,
        applicationCode: DictationErrorCodes.FORBIDDEN,
        httpStatus: 403,
        uiMessage: "Du hast keinen Zugriff auf die Cloud-Transkription.",
      });
    });

    it("does not trust desktop-only codes or localized text from HTTP", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({
        status: 500,
        json: {
          error: {
            code: "USER_DISMISSED",
            message: "boom",
            localizedMessage: {
              locale: "en",
              message: "Untrusted display override",
            },
          },
        },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.INTERNAL_SERVER_ERROR,
        applicationCode: undefined,
        httpStatus: 500,
        uiMessage: undefined,
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
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledOnce();
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledWith(true);
    });

    it("surfaces AUTH_REQUIRED when the retried request also returns 401", async () => {
      const provider = constructProviderWithTransport("http");
      mockFetchOnce({ status: 401, json: { error: {} } });
      mockFetchOnce({ status: 401, json: { error: {} } });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      await expect(provider.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.AUTH_REQUIRED,
        httpStatus: 401,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
        httpStatus: 401,
      });
    });
  });

  describe("gRPC error categorization", () => {
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

    it("falls back to HTTP on UNAUTHENTICATED and force-refreshes after HTTP 401", async () => {
      let token = "stale-id-token";
      authMock.instance.getIdToken.mockImplementation(async () => token);
      authMock.instance.refreshTokenIfNeeded.mockImplementation(
        async (force = false) => {
          if (force) token = "fresh-id-token";
        },
      );
      mockFetchOnce({ status: 401, json: { error: {} } });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "refreshed fallback" },
      });
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.UNAUTHENTICATED,
      );
      await expect(flushPromise).resolves.toEqual({
        text: "refreshed fallback",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(httpRequestSampleCount(0)).toBe(512);
      expect(httpRequestSampleCount(1)).toBe(512);
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledOnce();
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledWith(true);
      expect(
        (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)
          .Authorization,
      ).toBe("Bearer stale-id-token");
      expect(
        (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)
          .Authorization,
      ).toBe("Bearer fresh-id-token");
    });

    // Compatibility fallback for servers that do not send ErrorInfo yet.
    it("surfaces unstructured RESOURCE_EXHAUSTED as QUOTA_EXCEEDED", async () => {
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.RESOURCE_EXHAUSTED,
      );
      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.QUOTA_EXCEEDED,
        grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("prefers a structured quota reason and localized message", async () => {
      const provider = constructProviderWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock
        .getLastStream()!
        .emit(
          "error",
          new GrpcDictationError(
            "Word limit exceeded",
            grpcMock.status.RESOURCE_EXHAUSTED,
            undefined,
            "trace-rich",
            false,
            "QUOTA_EXCEEDED",
            "Du hast dein Transkriptionslimit erreicht.",
          ),
        );

      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.QUOTA_EXCEEDED,
        applicationCode: DictationErrorCodes.QUOTA_EXCEEDED,
        grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
        uiMessage: "Du hast dein Transkriptionslimit erreicht.",
        traceId: "trace-rich",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not treat a structured buffer limit as plan quota", async () => {
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "http fallback" },
      });
      const provider = constructProviderWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock
        .getLastStream()!
        .emit(
          "error",
          new GrpcDictationError(
            "buffer full",
            grpcMock.status.RESOURCE_EXHAUSTED,
            undefined,
            undefined,
            false,
            "AUDIO_BUFFER_EXCEEDED",
            "Too much audio was buffered.",
          ),
        );

      await expect(flushPromise).resolves.toMatchObject({
        text: "http fallback",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("maps structured FORBIDDEN the same way as HTTP without falling back", async () => {
      const provider = constructProviderWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock
        .getLastStream()!
        .emit(
          "error",
          new GrpcDictationError(
            "Cloud transcription access denied.",
            grpcMock.status.PERMISSION_DENIED,
            undefined,
            "trace-forbidden",
            false,
            "FORBIDDEN",
            "Du hast keinen Zugriff auf die Cloud-Transkription.",
          ),
        );

      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.INTERNAL_SERVER_ERROR,
        applicationCode: DictationErrorCodes.FORBIDDEN,
        grpcStatus: grpcMock.status.PERMISSION_DENIED,
        httpStatus: undefined,
        uiMessage: "Du hast keinen Zugriff auf die Cloud-Transkription.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(authMock.instance.refreshTokenIfNeeded).not.toHaveBeenCalled();
    });

    it("does not fall back on CANCELLED (user-initiated, e.g. reset during flush)", async () => {
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.CANCELLED,
      );
      // Should surface the cancellation as a NETWORK_ERROR, not trigger an HTTP transcription.
      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
        grpcStatus: grpcMock.status.CANCELLED,
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

    it("switches to HTTP between chunks and sends a multi-chunk oversized mirror whole", async () => {
      const trackCloudGrpcFallback = vi.fn();
      const telemetryStub = {
        trackCloudGrpcFallback,
      } as unknown as TelemetryService;
      process.env.CLOUD_DICTATION_TRANSPORT = "grpc";
      const provider = new AmicalCloudProvider(
        authMock.instance as unknown as AuthService,
        telemetryStub,
      );
      const mirroredSamples = HTTP_AUTO_FLUSH_SAMPLES + 512;

      await provider.transcribe({
        audioData: audioFrame(HTTP_AUTO_FLUSH_SAMPLES),
        speechProbability: 1,
        context: baseContext(),
      });
      await provider.transcribe({
        audioData: audioFrame(512),
        speechProbability: 1,
        context: baseContext(),
      });
      const grpcClient = grpcMock.getLastClient();
      const stream = grpcMock.getLastStream()!;

      // No transcribe or flush is pending when the stream reports auth failure.
      settleGrpcError(grpcMock.status.UNAUTHENTICATED, "expired token");
      await flush();
      // The observer switches routes but leaves the request to the next
      // serialized audio operation, which can return the cumulative result.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(trackCloudGrpcFallback).toHaveBeenCalledOnce();
      expect(trackCloudGrpcFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          grpc_status: grpcMock.status.UNAUTHENTICATED,
          fallback_stage: "transcribe",
        }),
      );
      const writesAfterFailure = stream.write.mock.calls.length;

      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "whole fallback" },
      });
      await expect(
        provider.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
      ).resolves.toMatchObject({ text: "whole fallback" });

      expect(grpcMock.getLastClient()).toBe(grpcClient);
      expect(stream.write).toHaveBeenCalledTimes(writesAfterFailure);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(httpRequestSampleCount()).toBe(mirroredSamples + 512);
      expect(httpRequestBody()).toMatchObject({ isFinal: false });
      expect(trackCloudGrpcFallback).toHaveBeenCalledOnce();
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
        {
          provider: new AmicalCloudProvider(
            authMock.instance as unknown as AuthService,
            telemetryStub,
          ),
        },
      );

      expect(trackCloudGrpcFallback).toHaveBeenCalledTimes(1);
      expect(trackCloudGrpcFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          error_code: ErrorCodes.NETWORK_ERROR,
          grpc_status: grpcMock.status.UNAVAILABLE,
          session_id: "session-1",
          fallback_stage: "flush",
        }),
      );
    });

    it("classifies structured SERVICE_UNAVAILABLE as a server error before fallback", async () => {
      const trackCloudGrpcFallback = vi.fn();
      const telemetryStub = {
        trackCloudGrpcFallback,
      } as unknown as TelemetryService;
      process.env.CLOUD_DICTATION_TRANSPORT = "grpc";
      const provider = new AmicalCloudProvider(
        authMock.instance as unknown as AuthService,
        telemetryStub,
      );
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "fallback worked" },
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock
        .getLastStream()!
        .emit(
          "error",
          new GrpcDictationError(
            "server shutting down",
            grpcMock.status.UNAVAILABLE,
            undefined,
            "trace-shutdown",
            false,
            DictationErrorCodes.SERVICE_UNAVAILABLE,
            "Cloud transcription is temporarily unavailable.",
          ),
        );

      await expect(flushPromise).resolves.toMatchObject({
        text: "fallback worked",
      });
      expect(trackCloudGrpcFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          error_code: ErrorCodes.INTERNAL_SERVER_ERROR,
          application_code: DictationErrorCodes.SERVICE_UNAVAILABLE,
          grpc_status: grpcMock.status.UNAVAILABLE,
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

    it("releases the gRPC mirror after a successful final on the same session", async () => {
      const provider = constructProviderWithTransport("grpc");
      const context = baseContext({ sessionId: "reused-session" });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context,
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context,
      });
      const firstFinalization = provider.flush(context);
      await flush();
      settleGrpcOk("first final");
      await firstFinalization;

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context,
      });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "second final" },
      });
      const secondFinalization = provider.flush(context);
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");

      await expect(secondFinalization).resolves.toMatchObject({
        text: "second final",
      });
      expect(httpRequestSampleCount()).toBe(512);
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

  describe("legacy session adapter", () => {
    it("retires unflushed audio when transcribe rotates to a new session ID", async () => {
      const provider = constructProviderWithTransport("http");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-A" }),
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-A" }),
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-B" }),
      });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "session B" },
      });

      await provider.flush(baseContext({ sessionId: "session-B" }));

      expect(httpRequestSampleCount()).toBe(512);
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toMatchObject({
        sessionId: "session-B",
      });
    });

    it("preserves flush-only finals while retiring another active session", async () => {
      const provider = constructProviderWithTransport("http");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-A" }),
      });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "formatted B" },
      });

      await provider.flush(
        baseContext({
          sessionId: "session-B",
          aggregatedTranscription: "raw B",
          formattingEnabled: true,
        }),
      );

      expect(httpRequestSampleCount()).toBe(0);
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toMatchObject({
        sessionId: "session-B",
        audioData: "",
        previousTranscription: "raw B",
      });
    });

    it("opens clean state when an aborted legacy session ID is reused", async () => {
      const provider = constructProviderWithTransport("http");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "reused" }),
      });
      fetchMock.mockImplementationOnce(
        (_url: unknown, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      );
      const controller = new AbortController();
      const oldFinalization = provider.flush(
        baseContext({ sessionId: "reused" }),
        controller.signal,
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

      controller.abort();
      await expect(oldFinalization).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "reused" }),
      });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "fresh" },
      });
      await provider.flush(baseContext({ sessionId: "reused" }));

      expect(httpRequestSampleCount(1)).toBe(512);
    });
  });

  describe("explicit session ownership", () => {
    it("isolates HTTP buffers and cancellation between sessions", async () => {
      const provider = constructProviderWithTransport("http");
      const sessionA = provider.openSession({ sessionId: "session-A" });
      const sessionB = provider.openSession({ sessionId: "session-B" });

      await sessionA.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "caller-A" }),
      });
      await sessionA.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "caller-A" }),
      });
      await sessionB.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "caller-B" }),
      });

      sessionA.cancel();
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "session B" },
      });

      await expect(
        sessionB.flush(baseContext({ sessionId: "wrong-id" })),
      ).resolves.toMatchObject({ text: "session B" });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(httpRequestSampleCount()).toBe(512);
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toMatchObject({
        sessionId: "session-B",
      });
      await expect(sessionA.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
    });

    it("keeps gRPC streams independent when one session is cancelled", async () => {
      const provider = constructProviderWithTransport("grpc");
      const sessionA = provider.openSession({ sessionId: "session-A" });
      const sessionB = provider.openSession({ sessionId: "session-B" });

      await sessionA.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const streamA = grpcMock.getLastStream()!;
      await sessionB.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const streamB = grpcMock.getLastStream()!;
      expect(streamB).not.toBe(streamA);

      sessionA.cancel();
      await flush();
      expect(streamA.end).toHaveBeenCalled();
      expect(streamB.end).not.toHaveBeenCalled();

      const finalB = sessionB.flush(baseContext());
      await flush();
      settleGrpcOk("session B");
      await expect(finalB).resolves.toMatchObject({ text: "session B" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps gRPC fallback sticky to only the failed session", async () => {
      const provider = constructProviderWithTransport("grpc");
      const sessionA = provider.openSession({ sessionId: "session-A" });
      const sessionB = provider.openSession({ sessionId: "session-B" });

      await sessionA.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const clientA = grpcMock.getLastClient();
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "session A over HTTP" },
      });
      const finalA = sessionA.flush(baseContext());
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");

      await expect(finalA).resolves.toMatchObject({
        text: "session A over HTTP",
      });
      expect(httpRequestSampleCount()).toBe(512);

      await sessionB.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      expect(grpcMock.getLastClient()).not.toBe(clientA);
      expect(fetchMock).toHaveBeenCalledOnce();

      const finalB = sessionB.flush(baseContext());
      await flush();
      settleGrpcOk("session B");
      await expect(finalB).resolves.toMatchObject({ text: "session B" });
    });

    it("starts clean when an application session ID is reused", async () => {
      const provider = constructProviderWithTransport("http");
      const first = provider.openSession({ sessionId: "reused" });
      await first.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await first.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      first.cancel();

      const second = provider.openSession({ sessionId: "reused" });
      await second.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "fresh" },
      });

      await expect(second.flush(baseContext())).resolves.toMatchObject({
        text: "fresh",
      });
      expect(httpRequestSampleCount()).toBe(512);
    });

    it("makes cancellation idempotent and permanently closes the handle", async () => {
      const provider = constructProviderWithTransport("http");
      const session = provider.openSession({ sessionId: "session-A" });

      expect(() => {
        session.cancel();
        session.cancel();
      }).not.toThrow();

      await expect(
        session.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.NETWORK_ERROR });
      await expect(session.flush(baseContext())).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
      expect(session.updateSessionContext).toBeDefined();
      await expect(
        session.updateSessionContext!(baseContext()),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.NETWORK_ERROR });
      expect(authMock.instance.isAuthenticated).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not let legacy reset cancel an explicit session", async () => {
      const provider = constructProviderWithTransport("http");
      const session = provider.openSession({ sessionId: "explicit" });
      await session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "legacy" }),
      });

      provider.reset();
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "still active" },
      });

      await expect(session.flush(baseContext())).resolves.toMatchObject({
        text: "still active",
      });
      expect(httpRequestSampleCount()).toBe(512);
    });

    it("ignores a legacy context update for a different session", async () => {
      const provider = constructProviderWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-A" }),
      });
      const stream = grpcMock.getLastStream()!;
      const writesBefore = stream.write.mock.calls.length;

      await provider.updateSessionContext(
        baseContext({
          sessionId: "session-B",
          accessibilityContext: accessibilityContext("com.example.other"),
        }),
      );

      expect(grpcMock.getLastStream()).toBe(stream);
      expect(stream.write).toHaveBeenCalledTimes(writesBefore);
      expect(stream.end).not.toHaveBeenCalled();
    });

    it("cannot open a late gRPC stream after cancellation during token lookup", async () => {
      const provider = constructProviderWithTransport("grpc");
      const session = provider.openSession({ sessionId: "session-A" });
      let resolveToken!: (token: string) => void;
      authMock.instance.getIdToken.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve;
          }),
      );

      const transcribe = session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await vi.waitFor(() => {
        expect(authMock.instance.getIdToken).toHaveBeenCalledOnce();
      });

      session.cancel();
      resolveToken("late-token");

      await expect(transcribe).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
      expect(grpcMock.getLastClient()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cannot start HTTP after cancellation during authentication", async () => {
      const provider = constructProviderWithTransport("http");
      const session = provider.openSession({ sessionId: "session-A" });
      let releaseAuthentication!: () => void;
      const authenticationGate = new Promise<void>((resolve) => {
        releaseAuthentication = resolve;
      });
      authMock.instance.isAuthenticated.mockImplementationOnce(async () => {
        await authenticationGate;
        return true;
      });

      const transcribe = session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await vi.waitFor(() => {
        expect(authMock.instance.isAuthenticated).toHaveBeenCalledOnce();
      });

      session.cancel();
      releaseAuthentication();

      await expect(transcribe).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
      expect(authMock.instance.getIdToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cannot restore session state after cancellation during settings lookup", async () => {
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      process.env.CLOUD_DICTATION_TRANSPORT = "http";
      let resolveLabs!: (settings: { selfCorrection: boolean }) => void;
      const settingsService = {
        getLabsSettings: vi.fn(
          () =>
            new Promise<{ selfCorrection: boolean }>((resolve) => {
              resolveLabs = resolve;
            }),
        ),
      } as unknown as SettingsService;
      const provider = new AmicalCloudProvider(
        authMock.instance as unknown as AuthService,
        null,
        settingsService,
      );
      const session = provider.openSession({ sessionId: "session-A" });

      const transcribe = session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await vi.waitFor(() => {
        expect(settingsService.getLabsSettings).toHaveBeenCalledOnce();
      });

      session.cancel();
      resolveLabs({ selfCorrection: true });

      await expect(transcribe).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
      expect(authMock.instance.isAuthenticated).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cannot start HTTP after cancellation during token lookup", async () => {
      const provider = constructProviderWithTransport("http");
      const session = provider.openSession({ sessionId: "session-A" });
      await session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      let resolveToken!: (token: string) => void;
      authMock.instance.getIdToken.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve;
          }),
      );

      const finalization = session.flush(baseContext());
      await vi.waitFor(() => {
        expect(authMock.instance.getIdToken).toHaveBeenCalledOnce();
      });

      session.cancel();
      resolveToken("late-token");

      await expect(finalization).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("disposes legacy and explicit sessions once and rejects later work", async () => {
      const provider = constructProviderWithTransport("grpc");
      const first = provider.openSession({ sessionId: "first" });
      const second = provider.openSession({ sessionId: "second" });
      const cancelFirst = vi.spyOn(first, "cancel");
      const cancelSecond = vi.spyOn(second, "cancel");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "legacy" }),
      });
      const legacyStream = grpcMock.getLastStream()!;

      const firstDisposal = provider.dispose();
      const secondDisposal = provider.dispose();
      expect(secondDisposal).toBe(firstDisposal);
      await firstDisposal;
      await flush();

      expect(cancelFirst).toHaveBeenCalledOnce();
      expect(cancelSecond).toHaveBeenCalledOnce();
      expect(legacyStream.end).toHaveBeenCalled();
      await expect(
        first.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.NETWORK_ERROR });
      expect(() =>
        provider.openSession({ sessionId: "after-dispose" }),
      ).toThrow("disposed");
      await expect(provider.warmup()).rejects.toThrow("disposed");
      expect(authMock.instance.refreshTokenIfNeeded).not.toHaveBeenCalled();
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

    it("cancels the in-flight gRPC flush through the session and does not fall back to HTTP", async () => {
      const provider = constructProviderWithTransport("grpc");

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const stream = grpcMock.getLastStream()!;
      const controller = new AbortController();
      const flushPromise = provider.flush(baseContext(), controller.signal);
      await flush();

      controller.abort(); // dismiss → session.cancel() → stream.cancel()

      await expect(flushPromise).rejects.toMatchObject({
        errorCode: ErrorCodes.NETWORK_ERROR,
        grpcStatus: grpcMock.status.CANCELLED,
      });
      expect(stream.end).toHaveBeenCalled();
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
