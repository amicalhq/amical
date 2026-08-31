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

  class FakeClient {
    close = vi.fn();
    constructor() {
      lastClient = this;
    }
    makeBidiStreamRequest = vi.fn(() => {
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
    getLastClient: () => lastClient,
    reset: () => {
      lastStream = null;
      lastClient = null;
    },
  };
});

const httpClientMock = vi.hoisted(() => ({ locale: "en" }));

vi.mock("@grpc/grpc-js", () => grpcMock.module);

// ---- AuthService mock ----------------------------------------------------

const authMock = (() => {
  const isAuthenticated = vi.fn(() => EffectLib.succeed(true));
  const getIdToken = vi.fn(() => EffectLib.succeed("test-id-token"));
  const refreshTokenIfNeeded = vi
    .fn<(force?: boolean) => EffectLib.Effect<void, unknown>>()
    .mockReturnValue(EffectLib.void);
  return {
    instance: { isAuthenticated, getIdToken, refreshTokenIfNeeded },
    reset: () => {
      isAuthenticated.mockReset();
      isAuthenticated.mockReturnValue(EffectLib.succeed(true));
      getIdToken.mockReset();
      getIdToken.mockReturnValue(EffectLib.succeed("test-id-token"));
      refreshTokenIfNeeded.mockReset();
      refreshTokenIfNeeded.mockReturnValue(EffectLib.void);
    },
  };
})();

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
import { CloudDictationGrpcStream } from "../../src/pipeline/providers/transcription/grpc-dictation-client";
import { decodeWireFailure } from "../../src/pipeline/providers/transcription/cloud-wire-decode";
import { StreamTranscribeRequest } from "../../src/pipeline/providers/transcription/gen/amical/dictation/v1/dictation";
import { DictationErrorCodes, ErrorCodes } from "../../src/types/error";
import {
  AuthenticationRequired,
  CloudQuotaExceeded as CloudQuotaExceededVariant,
  IdleTimeout,
} from "../../src/types/errors";
import { Effect as EffectLib } from "effect";
import type {
  TranscribeContext,
  TranscriptionProviderSession,
} from "../../src/pipeline/core/pipeline-types";
import type { GetAccessibilityContextResult } from "@amical/types";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import type { AuthService } from "../../src/services/auth-service";
import {
  expectRejectionProjection,
  projectionOf,
} from "../helpers/error-projection";

// ---- Helpers ------------------------------------------------------------

const flush = () => new Promise((r) => setImmediate(r));

type TestCloudSession = Omit<
  TranscriptionProviderSession,
  "updateSessionContext"
> & {
  updateSessionContext(context: TranscribeContext): Promise<void>;
};

const openCloudSession = (
  engine: AmicalCloudProvider,
  options: {
    sessionId?: string;
    onTerminalFailure?: (error: Error) => void;
  } = {},
): TestCloudSession => {
  return engine.openSession({
    sessionId: options.sessionId ?? "session-1",
    onTerminalFailure: options.onTerminalFailure,
  }) as TestCloudSession;
};

const constructEngineWithTransport = (transport: "grpc" | "http") => {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  process.env.CLOUD_DICTATION_TRANSPORT = transport;
  return new AmicalCloudProvider(authMock.instance as unknown as AuthService);
};

const openCloudSessionWithTransport = (
  transport: "grpc" | "http",
  options: {
    sessionId?: string;
    onTerminalFailure?: (error: Error) => void;
  } = {},
): TestCloudSession => {
  return openCloudSession(constructEngineWithTransport(transport), options);
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
      const provider = openCloudSessionWithTransport("grpc");
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
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSessionWithTransport("grpc");

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
      const provider = openCloudSessionWithTransport("grpc");

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
      const provider = openCloudSessionWithTransport("grpc");
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
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSessionWithTransport("http");

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
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSessionWithTransport("http");

      await expect(provider.flush(baseContext())).resolves.toEqual({
        text: "",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends text-only final flush for instruct even when formatting is off", async () => {
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSession(
        new AmicalCloudProvider(
          authMock.instance as unknown as AuthService,
          null,
          settingsService,
        ),
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

      expect(settingsService.getLabsSettings).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers).toMatchObject({
        "amical-labs": "self-correction",
        "Accept-Language": "ja",
      });
    });
  });

  describe("HTTP error surfacing", () => {
    it("surfaces 500 as INTERNAL_SERVER_ERROR", async () => {
      const provider = openCloudSessionWithTransport("http");
      mockFetchOnce({
        status: 500,
        json: { error: { code: undefined, message: "boom" } },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expectRejectionProjection(provider.flush(baseContext()), {
        message: "boom",
        code: ErrorCodes.INTERNAL_SERVER_ERROR,
        tag: "ServerRejected",
        httpStatus: 500,
        uiMessage: undefined,
      });
    });

    it("uses only localizedMessage as the user-facing HTTP override", async () => {
      const provider = openCloudSessionWithTransport("http");
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

      await expectRejectionProjection(provider.flush(baseContext()), {
        message: "The account has exhausted its dictation quota.",
        code: ErrorCodes.QUOTA_EXCEEDED,
        wireCode: DictationErrorCodes.QUOTA_EXCEEDED,
        httpStatus: 402,
        uiMessage: "Du hast dein Transkriptionslimit erreicht.",
        traceId: "trace-http",
      });
    });

    it("maps a validated FORBIDDEN code independently of its HTTP status", async () => {
      const provider = openCloudSessionWithTransport("http");
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

      await expectRejectionProjection(provider.flush(baseContext()), {
        code: ErrorCodes.INTERNAL_SERVER_ERROR,
        tag: "AccessForbidden",
        wireCode: DictationErrorCodes.FORBIDDEN,
        httpStatus: 403,
        uiMessage: "Du hast keinen Zugriff auf die Cloud-Transkription.",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(authMock.instance.refreshTokenIfNeeded).not.toHaveBeenCalled();
    });

    it("does not refresh AUTH_REQUIRED returned with HTTP 403", async () => {
      const provider = openCloudSessionWithTransport("http");
      mockFetchOnce({
        status: 403,
        json: {
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication rejected without a refresh challenge.",
          },
        },
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      await expectRejectionProjection(provider.flush(baseContext()), {
        code: ErrorCodes.AUTH_REQUIRED,
        tag: "AuthenticationRequired",
        wireCode: DictationErrorCodes.AUTH_REQUIRED,
        httpStatus: 403,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(authMock.instance.refreshTokenIfNeeded).not.toHaveBeenCalled();
    });

    it("does not trust desktop-only codes or localized text from HTTP", async () => {
      const provider = openCloudSessionWithTransport("http");
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

      await expectRejectionProjection(provider.flush(baseContext()), {
        code: ErrorCodes.INTERNAL_SERVER_ERROR,
        wireCode: undefined,
        httpStatus: 500,
        uiMessage: undefined,
      });
    });

    it("surfaces a thrown network error as NETWORK_ERROR", async () => {
      const provider = openCloudSessionWithTransport("http");
      fetchMock.mockImplementationOnce(async () => {
        throw new Error("ECONNREFUSED");
      });
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expectRejectionProjection(provider.flush(baseContext()), {
        code: ErrorCodes.NETWORK_ERROR,
      });
    });

    it("retries once on 401 with a refreshed token, then succeeds", async () => {
      const provider = openCloudSessionWithTransport("http");
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
      const provider = openCloudSessionWithTransport("http");
      mockFetchOnce({ status: 401, json: { error: {} } });
      mockFetchOnce({ status: 401, json: { error: {} } });

      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      await expectRejectionProjection(provider.flush(baseContext()), {
        code: ErrorCodes.AUTH_REQUIRED,
        tag: "AuthenticationRequired",
        httpStatus: 401,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledOnce();
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledWith(true);
    });

    it("surfaces AUTH_REQUIRED when token refresh fails after 401", async () => {
      const provider = openCloudSessionWithTransport("http");
      mockFetchOnce({ status: 401, json: { error: {} } });
      authMock.instance.refreshTokenIfNeeded.mockReturnValueOnce(
        EffectLib.fail(new Error("refresh failed")),
      );
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expectRejectionProjection(provider.flush(baseContext()), {
        code: ErrorCodes.AUTH_REQUIRED,
        tag: "AuthenticationRequired",
        httpStatus: 401,
      });
    });
  });

  describe("gRPC error categorization", () => {
    const driveGrpcThenSettleError = async (errorCode: number) => {
      const provider = openCloudSessionWithTransport("grpc");
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

    it("I-51: reports a non-fallback gRPC failure for the active explicit session once", async () => {
      const cancelStream = vi.spyOn(
        CloudDictationGrpcStream.prototype,
        "cancel",
      );
      const onTerminalFailure = vi.fn();
      const session = openCloudSessionWithTransport("grpc", {
        onTerminalFailure,
      });
      await session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      const stream = grpcMock.getLastStream()!;
      stream.emit(
        "error",
        decodeWireFailure({
          message: "Word limit exceeded",
          grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
          traceId: "trace-terminal",
          rawWireCode: DictationErrorCodes.QUOTA_EXCEEDED,
          localizedMessage: "Quota reached.",
        }),
      );

      await vi.waitFor(() => {
        expect(onTerminalFailure).toHaveBeenCalledOnce();
      });
      expect(cancelStream).toHaveBeenCalledOnce();
      expect(projectionOf(onTerminalFailure.mock.calls[0]![0])).toMatchObject({
        code: ErrorCodes.QUOTA_EXCEEDED,
        wireCode: DictationErrorCodes.QUOTA_EXCEEDED,
        grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
        traceId: "trace-terminal",
      });

      stream.emit("status", {
        code: grpcMock.status.RESOURCE_EXHAUSTED,
        details: "Word limit exceeded",
        metadata: grpcMock.metadata(),
      });
      await flush();
      expect(onTerminalFailure).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      cancelStream.mockRestore();
    });

    it("I-51: reports an unstructured non-fallback gRPC failure", async () => {
      const onTerminalFailure = vi.fn();
      const session = openCloudSessionWithTransport("grpc", {
        onTerminalFailure,
      });
      await session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      settleGrpcError(grpcMock.status.RESOURCE_EXHAUSTED, "resource exhausted");

      await vi.waitFor(() => {
        expect(onTerminalFailure).toHaveBeenCalledOnce();
      });
      expect(projectionOf(onTerminalFailure.mock.calls[0]![0])).toMatchObject({
        code: ErrorCodes.QUOTA_EXCEEDED,
        grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("I-51: keeps fallback-eligible observed failures inside the explicit session", async () => {
      const onTerminalFailure = vi.fn();
      const session = openCloudSessionWithTransport("grpc", {
        onTerminalFailure,
      });
      await session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      settleGrpcError(
        grpcMock.status.UNAUTHENTICATED,
        "stale call credentials",
      );
      await flush();

      expect(onTerminalFailure).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      session.cancel();
    });

    it("I-51: falls back to HTTP on UNAUTHENTICATED and force-refreshes after HTTP 401", async () => {
      let token = "stale-id-token";
      authMock.instance.getIdToken.mockImplementation(() =>
        EffectLib.succeed(token),
      );
      authMock.instance.refreshTokenIfNeeded.mockImplementation(
        (force = false) =>
          EffectLib.sync(() => {
            if (force) token = "fresh-id-token";
          }),
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
      await expectRejectionProjection(flushPromise, {
        code: ErrorCodes.QUOTA_EXCEEDED,
        grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("prefers a structured quota reason and localized message", async () => {
      const provider = openCloudSessionWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock.getLastStream()!.emit(
        "error",
        decodeWireFailure({
          message: "Word limit exceeded",
          grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
          traceId: "trace-rich",
          rawWireCode: "QUOTA_EXCEEDED",
          localizedMessage: "Du hast dein Transkriptionslimit erreicht.",
        }),
      );

      await expectRejectionProjection(flushPromise, {
        code: ErrorCodes.QUOTA_EXCEEDED,
        wireCode: DictationErrorCodes.QUOTA_EXCEEDED,
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
      const provider = openCloudSessionWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock.getLastStream()!.emit(
        "error",
        decodeWireFailure({
          message: "buffer full",
          grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
          rawWireCode: "AUDIO_BUFFER_EXCEEDED",
          localizedMessage: "Too much audio was buffered.",
        }),
      );

      await expect(flushPromise).resolves.toMatchObject({
        text: "http fallback",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("maps structured FORBIDDEN the same way as HTTP without falling back", async () => {
      const provider = openCloudSessionWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();

      grpcMock.getLastStream()!.emit(
        "error",
        decodeWireFailure({
          message: "Cloud transcription access denied.",
          grpcStatus: grpcMock.status.PERMISSION_DENIED,
          traceId: "trace-forbidden",
          rawWireCode: "FORBIDDEN",
          localizedMessage:
            "Du hast keinen Zugriff auf die Cloud-Transkription.",
        }),
      );

      await expectRejectionProjection(flushPromise, {
        code: ErrorCodes.INTERNAL_SERVER_ERROR,
        wireCode: DictationErrorCodes.FORBIDDEN,
        grpcStatus: grpcMock.status.PERMISSION_DENIED,
        httpStatus: undefined,
        uiMessage: "Du hast keinen Zugriff auf die Cloud-Transkription.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(authMock.instance.refreshTokenIfNeeded).not.toHaveBeenCalled();
    });

    it("does not fall back on a gRPC CANCELLED status", async () => {
      const { flushPromise } = await driveGrpcThenSettleError(
        grpcMock.status.CANCELLED,
      );
      // Should surface the cancellation as a NETWORK_ERROR, not trigger an HTTP transcription.
      await expectRejectionProjection(flushPromise, {
        code: ErrorCodes.NETWORK_ERROR,
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
        provider?: TestCloudSession;
        sessionId?: string;
      } = {},
    ) => {
      const provider =
        options.provider ??
        openCloudSessionWithTransport("grpc", {
          sessionId: options.sessionId,
        });
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
      const provider = openCloudSessionWithTransport("grpc");
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

    it("I-51: keeps the gRPC failure internal and rejects the caller when HTTP fallback is exhausted", async () => {
      const onTerminalFailure = vi.fn();
      const session = openCloudSessionWithTransport("grpc", {
        onTerminalFailure,
      });

      await session.transcribe({
        audioData: audioFrame(HTTP_AUTO_FLUSH_SAMPLES),
        speechProbability: 1,
        context: baseContext(),
      });
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      await flush();

      mockFetchOnce({
        status: 500,
        json: { error: { message: "fallback failed" } },
      });
      await expectRejectionProjection(
        session.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
        {
          code: ErrorCodes.INTERNAL_SERVER_ERROR,
          httpStatus: 500,
        },
      );

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(onTerminalFailure).not.toHaveBeenCalled();
    });

    it("switches to HTTP between chunks and sends a multi-chunk oversized mirror whole", async () => {
      const trackCloudGrpcFallback = vi.fn();
      const telemetryStub = {
        trackCloudGrpcFallback,
      } as unknown as TelemetryService;
      process.env.CLOUD_DICTATION_TRANSPORT = "grpc";
      const provider = openCloudSession(
        new AmicalCloudProvider(
          authMock.instance as unknown as AuthService,
          telemetryStub,
        ),
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
      const engine = constructEngineWithTransport("grpc");
      const sessionA = openCloudSession(engine, { sessionId: "session-A" });
      const { grpcClient: clientForSessionA } = await driveGrpcAndFallback(
        grpcMock.status.UNAVAILABLE,
        {
          status: 200,
          json: { success: true, transcription: "session-A http" },
        },
        { provider: sessionA, sessionId: "session-A" },
      );

      const sessionB = openCloudSession(engine, {
        sessionId: "session-B",
      });
      await sessionB.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-B" }),
      });

      expect(grpcMock.getLastClient()).not.toBe(clientForSessionA);
      expect(grpcMock.getLastClient()).not.toBeNull();
      // Drain session B's gRPC deferred so the test doesn't leave it dangling.
      settleGrpcOk("");
      await sessionB.flush(baseContext({ sessionId: "session-B" }));
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
          provider: openCloudSession(
            new AmicalCloudProvider(
              authMock.instance as unknown as AuthService,
              telemetryStub,
            ),
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
      const provider = openCloudSession(
        new AmicalCloudProvider(
          authMock.instance as unknown as AuthService,
          telemetryStub,
        ),
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

      grpcMock.getLastStream()!.emit(
        "error",
        decodeWireFailure({
          message: "server shutting down",
          grpcStatus: grpcMock.status.UNAVAILABLE,
          traceId: "trace-shutdown",
          rawWireCode: DictationErrorCodes.SERVICE_UNAVAILABLE,
          localizedMessage: "Cloud transcription is temporarily unavailable.",
        }),
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
      const provider = openCloudSessionWithTransport("grpc");

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
      const provider = openCloudSessionWithTransport("grpc");

      // One short frame: below MIN_AUDIO_DURATION_MS, so the fallback route
      // does not transcribe yet (no HTTP request during transcribe).
      const chunk = await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      expect(chunk.text).toBe("");

      // A fallback-eligible wire failure on the open stream engages the
      // transcribe-stage fallback through the observed channel. (A stream
      // CONSTRUCTION throw no longer falls back — a client-local throw is a
      // defect now, pinned separately.)
      grpcMock.getLastStream()!.emit("status", {
        code: grpcMock.status.UNAVAILABLE,
        details: "",
        metadata: grpcMock.metadata(),
      });
      await flush();
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
      const engine = constructEngineWithTransport("grpc");
      const sessionA = openCloudSession(engine, { sessionId: "session-A" });

      // Session A: stream two frames over gRPC and finish successfully.
      for (let i = 0; i < 2; i++) {
        await sessionA.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext({ sessionId: "session-A" }),
        });
      }
      const flushA = sessionA.flush(baseContext({ sessionId: "session-A" }));
      await flush();
      settleGrpcOk("session A text");
      await flushA;

      // Session B: stream one frame, then fall back to HTTP at flush.
      const sessionB = openCloudSession(engine, { sessionId: "session-B" });
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "session B http" },
      });
      await sessionB.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext({ sessionId: "session-B" }),
      });
      const flushB = sessionB.flush(baseContext({ sessionId: "session-B" }));
      await flush();
      settleGrpcError(grpcMock.status.UNAVAILABLE, "transport down");
      const result = await flushB;

      expect(result.text).toBe("session B http");
      // Only session B's single frame — session A's two frames must be gone.
      const sampleCount = httpRequestSampleCount();
      expect(sampleCount).toBe(512);
    });

    it("releases the gRPC mirror after a successful final on the same session", async () => {
      const provider = openCloudSessionWithTransport("grpc", {
        sessionId: "reused-session",
      });
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

    it("cancel() discards mirrored audio so it cannot leak into a later session", async () => {
      const engine = constructEngineWithTransport("grpc");
      const firstSession = openCloudSession(engine, {
        sessionId: "reused-session",
      });

      // Stream two frames over gRPC, then cancel that operation.
      for (let i = 0; i < 2; i++) {
        await firstSession.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        });
      }
      firstSession.cancel();
      await flush();

      const provider = openCloudSession(engine, {
        sessionId: "reused-session",
      });

      // A fresh frame, then fall back to HTTP at flush.
      mockFetchOnce({
        status: 200,
        json: { success: true, transcription: "after cancel" },
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

      expect(result.text).toBe("after cancel");
      const sampleCount = httpRequestSampleCount();
      // Only the new session's frame; the cancelled session's frames are gone.
      expect(sampleCount).toBe(512);
    });
  });

  describe("variant passthrough", () => {
    it("a cloud variant thrown internally is not double-wrapped", async () => {
      const provider = openCloudSessionWithTransport("http");
      authMock.instance.isAuthenticated.mockReturnValueOnce(
        EffectLib.succeed(false),
      );
      const promise = provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      await expect(promise).rejects.toBeInstanceOf(AuthenticationRequired);
      await expectRejectionProjection(promise, {
        code: ErrorCodes.AUTH_REQUIRED,
      });
    });
  });

  describe("idle timeout", () => {
    it("surfaces leaf idle-timeout as IDLE_TIMEOUT (not NETWORK_ERROR) and does not fall back to HTTP", async () => {
      const provider = openCloudSessionWithTransport("grpc");

      // Open a gRPC stream by transcribing once.
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      const stream = grpcMock.getLastStream()!;
      const flushPromise = provider.flush(baseContext());
      await flush();

      // Inject the same idle-timeout failure the leaf timer would
      // synthesize. Going through the leaf's real timer would require
      // vi.useFakeTimers and 10s of advancement; the leaf already has
      // dedicated tests for that path.
      stream.emit(
        "error",
        new IdleTimeout({
          message: "gRPC stream idle for 10000ms",
          meta: { grpcStatus: grpcMock.status.CANCELLED },
        }),
      );

      await expectRejectionProjection(flushPromise, {
        code: "IDLE_TIMEOUT",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("warmup", () => {
    it("warmup() calls refreshTokenIfNeeded but does NOT open a gRPC stream", async () => {
      const engine = constructEngineWithTransport("grpc");
      await engine.warmup();
      expect(authMock.instance.refreshTokenIfNeeded).toHaveBeenCalledTimes(1);
      expect(grpcMock.getLastClient()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("explicit session ownership", () => {
    it("ignores a late terminal failure from a cancelled explicit session", async () => {
      const onSessionAFailure = vi.fn();
      const onSessionBFailure = vi.fn();
      const engine = constructEngineWithTransport("grpc");
      const sessionA = engine.openSession({
        sessionId: "session-A",
        onTerminalFailure: onSessionAFailure,
      });
      await sessionA.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const streamA = grpcMock.getLastStream()!;
      sessionA.cancel();
      await flush();

      const sessionB = engine.openSession({
        sessionId: "session-B",
        onTerminalFailure: onSessionBFailure,
      });
      await sessionB.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });

      streamA.emit(
        "error",
        decodeWireFailure({
          message: "late quota",
          grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
          rawWireCode: DictationErrorCodes.QUOTA_EXCEEDED,
        }),
      );
      await flush();

      expect(onSessionAFailure).not.toHaveBeenCalled();
      expect(onSessionBFailure).not.toHaveBeenCalled();
      sessionB.cancel();
    });

    it("isolates HTTP buffers and cancellation between sessions", async () => {
      const engine = constructEngineWithTransport("http");
      const sessionA = engine.openSession({ sessionId: "session-A" });
      const sessionB = engine.openSession({ sessionId: "session-B" });

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
      await expectRejectionProjection(sessionA.flush(baseContext()), {
        code: ErrorCodes.NETWORK_ERROR,
      });
    });

    it("keeps gRPC streams independent when one session is cancelled", async () => {
      const engine = constructEngineWithTransport("grpc");
      const sessionA = engine.openSession({ sessionId: "session-A" });
      const sessionB = engine.openSession({ sessionId: "session-B" });

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
      const engine = constructEngineWithTransport("grpc");
      const sessionA = engine.openSession({ sessionId: "session-A" });
      const sessionB = engine.openSession({ sessionId: "session-B" });

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
      const engine = constructEngineWithTransport("http");
      const first = engine.openSession({ sessionId: "reused" });
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

      const second = engine.openSession({ sessionId: "reused" });
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
      const session = openCloudSessionWithTransport("http", {
        sessionId: "session-A",
      });

      expect(() => {
        session.cancel();
        session.cancel();
      }).not.toThrow();

      await expectRejectionProjection(
        session.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
        { code: ErrorCodes.NETWORK_ERROR },
      );
      await expectRejectionProjection(session.flush(baseContext()), {
        code: ErrorCodes.NETWORK_ERROR,
      });
      expect(session.updateSessionContext).toBeDefined();
      await expectRejectionProjection(
        session.updateSessionContext!(baseContext()),
        { code: ErrorCodes.NETWORK_ERROR },
      );
      expect(authMock.instance.isAuthenticated).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cannot open a late gRPC stream after cancellation during token lookup", async () => {
      const session = openCloudSessionWithTransport("grpc", {
        sessionId: "session-A",
      });
      let resolveToken!: (token: string) => void;
      authMock.instance.getIdToken.mockImplementationOnce(() =>
        EffectLib.async<string>((resume) => {
          resolveToken = (token) => resume(EffectLib.succeed(token));
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

      await expectRejectionProjection(transcribe, {
        code: ErrorCodes.NETWORK_ERROR,
      });
      expect(grpcMock.getLastClient()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cannot start HTTP after cancellation during authentication", async () => {
      const session = openCloudSessionWithTransport("http", {
        sessionId: "session-A",
      });
      let releaseAuthentication!: () => void;
      authMock.instance.isAuthenticated.mockImplementationOnce(() =>
        EffectLib.async<boolean>((resume) => {
          releaseAuthentication = () => resume(EffectLib.succeed(true));
        }),
      );

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

      await expectRejectionProjection(transcribe, {
        code: ErrorCodes.NETWORK_ERROR,
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

      await expectRejectionProjection(transcribe, {
        code: ErrorCodes.NETWORK_ERROR,
      });
      expect(authMock.instance.isAuthenticated).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cannot start HTTP after cancellation during token lookup", async () => {
      const session = openCloudSessionWithTransport("http", {
        sessionId: "session-A",
      });
      await session.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      let resolveToken!: (token: string) => void;
      authMock.instance.getIdToken.mockImplementationOnce(() =>
        EffectLib.async<string>((resume) => {
          resolveToken = (token) => resume(EffectLib.succeed(token));
        }),
      );

      const finalization = session.flush(baseContext());
      await vi.waitFor(() => {
        expect(authMock.instance.getIdToken).toHaveBeenCalledOnce();
      });

      session.cancel();
      resolveToken("late-token");

      await expectRejectionProjection(finalization, {
        code: ErrorCodes.NETWORK_ERROR,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("disposes explicit sessions once and rejects later work", async () => {
      const engine = constructEngineWithTransport("grpc");
      const first = engine.openSession({ sessionId: "first" });
      const second = engine.openSession({ sessionId: "second" });
      const cancelFirst = vi.spyOn(first, "cancel");
      const cancelSecond = vi.spyOn(second, "cancel");
      await first.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const stream = grpcMock.getLastStream()!;

      const firstDisposal = engine.dispose();
      const secondDisposal = engine.dispose();
      expect(secondDisposal).toBe(firstDisposal);
      await firstDisposal;
      await flush();

      expect(cancelFirst).toHaveBeenCalledOnce();
      expect(cancelSecond).toHaveBeenCalledOnce();
      expect(stream.end).toHaveBeenCalled();
      await expectRejectionProjection(
        first.transcribe({
          audioData: audioFrame(),
          speechProbability: 1,
          context: baseContext(),
        }),
        { code: ErrorCodes.NETWORK_ERROR },
      );
      expect(() => engine.openSession({ sessionId: "after-dispose" })).toThrow(
        "disposed",
      );
      await expect(engine.warmup()).rejects.toThrow("disposed");
      expect(authMock.instance.refreshTokenIfNeeded).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("cancel() clears state and tears down the in-flight gRPC stream", async () => {
      const provider = openCloudSessionWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const stream = grpcMock.getLastStream()!;
      const writesBefore = stream.write.mock.calls.length;
      provider.cancel();
      // CloudDictationGrpcStream.cancel() is fire-and-forget — the cancel frame
      // and end() run on the next microtask via runBackground.
      await flush();
      expect(stream.write.mock.calls.length).toBeGreaterThan(writesBefore);
      expect(stream.end).toHaveBeenCalled();
    });
  });

  describe("dismiss / abort wiring", () => {
    it("aborts the in-flight HTTP /transcribe request when the dismiss signal fires", async () => {
      const provider = openCloudSessionWithTransport("http");
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

      await expectRejectionProjection(flushPromise, {
        code: ErrorCodes.NETWORK_ERROR,
      });
      // The /transcribe request itself was aborted (not left hanging).
      expect(capturedSignal!.aborted).toBe(true);
    });

    it("cancels the in-flight gRPC flush through the session and does not fall back to HTTP", async () => {
      const provider = openCloudSessionWithTransport("grpc");

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

      await expectRejectionProjection(flushPromise, {
        code: ErrorCodes.NETWORK_ERROR,
        grpcStatus: grpcMock.status.CANCELLED,
      });
      expect(stream.end).toHaveBeenCalled();
      // A user-initiated cancel must NOT spawn a phantom HTTP fallback.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("scopes the abort signal to /transcribe only — auth calls carry no signal", async () => {
      const provider = openCloudSessionWithTransport("http");
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

// ---- Error characterization pins ----------------------------------------
// Row-by-row pins for the wire-code-less classification ladders and the
// fallback decision, asserted through the projectionOf pin surface. These
// freeze current behavior ahead of the error-model conversion; rows tagged
// DELIBERATE-CHANGE are the ones the conversion is allowed to flip, each
// with the new expectation recorded next to the old one.

describe("error characterization pins", () => {
  const settleFlushWithStatus = async (code: number, details = "") => {
    const provider = openCloudSessionWithTransport("grpc");
    await provider.transcribe({
      audioData: audioFrame(),
      speechProbability: 1,
      context: baseContext(),
    });
    const flushPromise = provider.flush(baseContext());
    await flush();
    settleGrpcError(code, details);
    const error = await flushPromise.then(
      () => {
        throw new Error("expected flush to reject");
      },
      (e: unknown) => e,
    );
    return projectionOf(error);
  };

  const settleFallbackAndCaptureTelemetry = async (
    settle: (
      stream: NonNullable<ReturnType<typeof grpcMock.getLastStream>>,
    ) => void,
  ) => {
    const trackCloudGrpcFallback = vi.fn();
    const telemetryStub = {
      trackCloudGrpcFallback,
    } as unknown as TelemetryService;
    process.env.CLOUD_DICTATION_TRANSPORT = "grpc";
    const provider = openCloudSession(
      new AmicalCloudProvider(
        authMock.instance as unknown as AuthService,
        telemetryStub,
      ),
    );
    await provider.transcribe({
      audioData: audioFrame(),
      speechProbability: 1,
      context: baseContext(),
    });
    mockFetchOnce({
      status: 200,
      json: { success: true, transcription: "via http" },
    });
    const flushPromise = provider.flush(baseContext());
    await flush();
    settle(grpcMock.getLastStream()!);
    await expect(flushPromise).resolves.toEqual({ text: "via http" });
    expect(fetchMock).toHaveBeenCalled();
    expect(trackCloudGrpcFallback).toHaveBeenCalledTimes(1);
    return trackCloudGrpcFallback.mock.calls[0]![0] as Record<string, unknown>;
  };

  describe("gRPC status-only rows that surface without fallback", () => {
    it("PERMISSION_DENIED projects AUTH_REQUIRED", async () => {
      const p = await settleFlushWithStatus(grpcMock.status.PERMISSION_DENIED);
      expect(p.code).toBe(ErrorCodes.AUTH_REQUIRED);
      expect(p.tag).toBe("AccessForbidden");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an HTTP 401 seen through grpc-js details projects AUTH_REQUIRED", async () => {
      const p = await settleFlushWithStatus(
        grpcMock.status.UNKNOWN,
        "Received HTTP status code 401",
      );
      expect(p.code).toBe(ErrorCodes.AUTH_REQUIRED);
      expect(p.tag).toBe("AuthenticationRequired");
      expect(p.httpStatus).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an HTTP 402 seen through grpc-js details projects QUOTA_EXCEEDED", async () => {
      const p = await settleFlushWithStatus(
        grpcMock.status.UNKNOWN,
        "Received HTTP status code 402",
      );
      expect(p.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an HTTP 403 seen through grpc-js details projects AUTH_REQUIRED", async () => {
      const p = await settleFlushWithStatus(
        grpcMock.status.UNKNOWN,
        "Received HTTP status code 403",
      );
      expect(p.code).toBe(ErrorCodes.AUTH_REQUIRED);
      expect(p.tag).toBe("AccessForbidden");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an HTTP 429 seen through grpc-js details projects RATE_LIMIT_EXCEEDED", async () => {
      const p = await settleFlushWithStatus(
        grpcMock.status.UNKNOWN,
        "Received HTTP status code 429",
      );
      expect(p.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a structured FORBIDDEN wire code projects INTERNAL_SERVER_ERROR and never falls back", async () => {
      const provider = openCloudSessionWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();
      grpcMock.getLastStream()!.emit(
        "error",
        decodeWireFailure({
          message: "forbidden",
          grpcStatus: grpcMock.status.PERMISSION_DENIED,
          traceId: "trace-forbidden",
          rawWireCode: DictationErrorCodes.FORBIDDEN,
        }),
      );
      const error = await flushPromise.then(
        () => {
          throw new Error("expected flush to reject");
        },
        (e: unknown) => e,
      );
      const p = projectionOf(error);
      expect(p.code).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
      expect(p.tag).toBe("AccessForbidden");
      expect(p.wireCode).toBe(DictationErrorCodes.FORBIDDEN);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("gRPC status-only rows that engage the HTTP fallback", () => {
    it("NOT_FOUND projects UNKNOWN", async () => {
      const payload = await settleFallbackAndCaptureTelemetry((stream) =>
        stream.emit("status", {
          code: grpcMock.status.NOT_FOUND,
          details: "",
          metadata: grpcMock.metadata(),
        }),
      );
      expect(payload.error_code).toBe(ErrorCodes.UNKNOWN);
    });

    it.each([
      ["INVALID_ARGUMENT", grpcMock.status.INVALID_ARGUMENT],
      ["DEADLINE_EXCEEDED", grpcMock.status.DEADLINE_EXCEEDED],
      ["ALREADY_EXISTS", grpcMock.status.ALREADY_EXISTS],
      ["FAILED_PRECONDITION", grpcMock.status.FAILED_PRECONDITION],
      ["INTERNAL", grpcMock.status.INTERNAL],
    ])("%s projects INTERNAL_SERVER_ERROR", async (_name, code) => {
      const payload = await settleFallbackAndCaptureTelemetry((stream) =>
        stream.emit("status", {
          code,
          details: "",
          metadata: grpcMock.metadata(),
        }),
      );
      expect(payload.error_code).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
    });

    it("an HTTP 502 seen through grpc-js details projects INTERNAL_SERVER_ERROR", async () => {
      const payload = await settleFallbackAndCaptureTelemetry((stream) =>
        stream.emit("status", {
          code: grpcMock.status.UNKNOWN,
          details: "Received HTTP status code 502",
          metadata: grpcMock.metadata(),
        }),
      );
      expect(payload.error_code).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
      expect(payload.http_status).toBe(502);
    });

    it("a status with no ladder row projects UNKNOWN", async () => {
      const payload = await settleFallbackAndCaptureTelemetry((stream) =>
        stream.emit("status", {
          code: grpcMock.status.UNKNOWN,
          details: "",
          metadata: grpcMock.metadata(),
        }),
      );
      expect(payload.error_code).toBe(ErrorCodes.UNKNOWN);
    });

    it("RESOURCE_EXHAUSTED with an unrecognized application code projects INTERNAL_SERVER_ERROR", async () => {
      // The absent-vs-invalid asymmetry: an absent code means plan quota,
      // an unrecognized code means the server said something newer than this
      // client — treated as a server error, never as the quota upsell.
      const payload = await settleFallbackAndCaptureTelemetry((stream) =>
        stream.emit(
          "error",
          decodeWireFailure({
            message: "resource exhausted",
            grpcStatus: grpcMock.status.RESOURCE_EXHAUSTED,
            traceId: "trace-unknown-code",
            rawWireCode: "USER_DISMISSED",
          }),
        ),
      );
      expect(payload.error_code).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
      expect(payload.application_code).toBeUndefined();
    });

    it("a foreign error object surfaces as a defect and fires NO fallback", async () => {
      // DELIBERATE-CHANGE, flipped here as tagged in the pin round: a
      // non-wire foreign value is a client bug — it must not retry as a
      // network failure. The raw value crosses the boundary (funnels to
      // UNKNOWN downstream) and the HTTP route never engages.
      const provider = openCloudSessionWithTransport("grpc");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const flushPromise = provider.flush(baseContext());
      await flush();
      grpcMock.getLastStream()!.emit("error", new TypeError("client-side bug"));
      await expect(flushPromise).rejects.toThrow("client-side bug");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("HTTP status-only rows", () => {
    const flushHttpWithResponse = async (response: {
      status: number;
      json?: unknown;
      jsonThrows?: boolean;
    }) => {
      const provider = openCloudSessionWithTransport("http");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const fetchImpl = global.fetch as Mock;
      fetchImpl.mockImplementationOnce(async () => ({
        status: response.status,
        ok: response.status < 400,
        statusText: `HTTP ${response.status}`,
        json: async () => {
          if (response.jsonThrows) throw new Error("bad json");
          return response.json;
        },
      }));
      const error = await provider.flush(baseContext()).then(
        () => {
          throw new Error("expected flush to reject");
        },
        (e: unknown) => e,
      );
      return projectionOf(error);
    };

    it("402 without a wire code projects QUOTA_EXCEEDED", async () => {
      const p = await flushHttpWithResponse({
        status: 402,
        json: { error: {} },
      });
      expect(p.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
      expect(p.httpStatus).toBe(402);
    });

    it("403 without a wire code projects AUTH_REQUIRED", async () => {
      const p = await flushHttpWithResponse({
        status: 403,
        json: { error: {} },
      });
      expect(p.code).toBe(ErrorCodes.AUTH_REQUIRED);
      expect(p.tag).toBe("AccessForbidden");
    });

    it("429 without a wire code projects RATE_LIMIT_EXCEEDED", async () => {
      const p = await flushHttpWithResponse({
        status: 429,
        json: { error: {} },
      });
      expect(p.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
    });

    it("an unclassified 4xx projects UNKNOWN", async () => {
      const p = await flushHttpWithResponse({
        status: 404,
        json: { error: {} },
      });
      expect(p.code).toBe(ErrorCodes.UNKNOWN);
    });

    it("an undecodable success body projects INTERNAL_SERVER_ERROR", async () => {
      const p = await flushHttpWithResponse({ status: 200, jsonThrows: true });
      expect(p.code).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
      expect(p.httpStatus).toBe(200);
    });

    it("a rejected fetch preserves the network error message", async () => {
      const provider = openCloudSessionWithTransport("http");
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      (global.fetch as Mock).mockImplementationOnce(async () => {
        throw new Error("socket hang up");
      });
      const error = await provider.flush(baseContext()).then(
        () => {
          throw new Error("expected flush to reject");
        },
        (e: unknown) => e,
      );
      const p = projectionOf(error);
      expect(p.code).toBe(ErrorCodes.NETWORK_ERROR);
      expect(p.message).toBe("socket hang up");
    });
  });

  describe("background client defects (observed channel)", () => {
    it("captures a foreign value once, delivers terminal, and never falls back", async () => {
      const captureException = vi.fn();
      const trackCloudGrpcFallback = vi.fn();
      const telemetryStub = {
        captureException,
        trackCloudGrpcFallback,
      } as unknown as TelemetryService;
      process.env.CLOUD_DICTATION_TRANSPORT = "grpc";
      const onTerminalFailure = vi.fn();
      const provider = openCloudSession(
        new AmicalCloudProvider(
          authMock.instance as unknown as AuthService,
          telemetryStub,
        ),
        { onTerminalFailure },
      );
      await provider.transcribe({
        audioData: audioFrame(),
        speechProbability: 1,
        context: baseContext(),
      });
      const bug = new TypeError("background client bug");
      grpcMock.getLastStream()!.emit("error", bug);
      await vi.waitFor(() => {
        expect(onTerminalFailure).toHaveBeenCalledOnce();
      });
      expect(onTerminalFailure).toHaveBeenCalledWith(bug);
      // Capture belongs to latch acceptance in the service, never to the
      // delivering channel — losing the race must not double-capture.
      expect(captureException).not.toHaveBeenCalled();
      expect(trackCloudGrpcFallback).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("provider exit settle (mixed cause integration)", () => {
    it("settles a mixed CloudError + dying finalizer with the typed value and captures the co-defect once", async () => {
      const captureException = vi.fn();
      const trackCloudGrpcFallback = vi.fn();
      const telemetryStub = {
        captureException,
        trackCloudGrpcFallback,
      } as unknown as TelemetryService;
      const session = openCloudSession(
        new AmicalCloudProvider(
          authMock.instance as unknown as AuthService,
          telemetryStub,
        ),
      );
      const typed = new CloudQuotaExceededVariant({ message: "quota" });
      const finalizerBug = new RangeError("finalizer bug");
      const mixed = EffectLib.fail(typed).pipe(
        EffectLib.ensuring(
          EffectLib.sync(() => {
            throw finalizerBug;
          }),
        ),
      );
      const runExit = (
        session as unknown as {
          runProviderEffect: (effect: unknown) => Promise<never>;
        }
      ).runProviderEffect.bind(session);
      const rejection = await runExit(mixed).then(
        () => {
          throw new Error("expected the exit to reject");
        },
        (error: unknown) => error,
      );
      expect(projectionOf(rejection)).toMatchObject({
        tag: "CloudQuotaExceeded",
        code: ErrorCodes.QUOTA_EXCEEDED,
      });
      expect(captureException).toHaveBeenCalledExactlyOnceWith(finalizerBug, {
        source: "dictation",
        session_id: "session-1",
      });
      expect(trackCloudGrpcFallback).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
