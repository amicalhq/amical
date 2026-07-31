import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenTranscriptionSessionOptions,
  PipelineContext,
  TranscribeContext,
  TranscribeParams,
  TranscriptionOutput,
} from "../../src/pipeline/core/pipeline-types";

const providerMocks = vi.hoisted(() => {
  const makeSession = (
    name: string,
    defaultFinalText: string,
    options: OpenTranscriptionSessionOptions,
  ) => ({
    name,
    sessionId: options.sessionId,
    transcribe: vi.fn<
      (params: TranscribeParams) => Promise<TranscriptionOutput>
    >(async () => ({ text: "" })),
    flush: vi.fn<
      (
        context: TranscribeContext,
        signal?: AbortSignal,
      ) => Promise<TranscriptionOutput>
    >(async () => ({ text: defaultFinalText })),
    cancel: vi.fn<() => void>(),
    updateSessionContext: vi.fn<(context: TranscribeContext) => Promise<void>>(
      async () => undefined,
    ),
  });

  const makeProvider = (name: string, defaultFinalText: string) => {
    const sessions = new Map<string, ReturnType<typeof makeSession>>();
    const sessionSetups = new Map<
      string,
      (session: ReturnType<typeof makeSession>) => void
    >();
    const openSession = vi.fn((options: OpenTranscriptionSessionOptions) => {
      const session = makeSession(name, defaultFinalText, options);
      sessionSetups.get(options.sessionId)?.(session);
      sessionSetups.delete(options.sessionId);
      sessions.set(options.sessionId, session);
      return session;
    });

    return {
      name,
      sessions,
      openSession,
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      updateSessionContext: vi.fn(),
      warmup: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      preloadModel: vi.fn(async () => undefined),
      getBindingInfo: vi.fn(async () => null),
      setupSession(
        sessionId: string,
        setup: (session: ReturnType<typeof makeSession>) => void,
      ) {
        sessionSetups.set(sessionId, setup);
      },
      resetTestState() {
        sessions.clear();
        sessionSetups.clear();
      },
    };
  };

  return {
    local: makeProvider("whisper-local", "local final"),
    cloud: makeProvider("amical-cloud", "cloud final"),
  };
});

vi.mock("../../src/db/transcriptions", () => ({
  createTranscription: vi.fn(async () => "txn-id"),
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

vi.mock("../../src/pipeline/providers/transcription/whisper-provider", () => ({
  WhisperProvider: vi.fn(function () {
    return providerMocks.local;
  }),
}));

vi.mock(
  "../../src/pipeline/providers/transcription/amical-cloud-provider",
  () => ({
    AmicalCloudProvider: vi.fn(function () {
      return providerMocks.cloud;
    }),
  }),
);

import {
  createTranscription,
  getTranscriptionById,
  updateTranscription,
} from "../../src/db/transcriptions";
import { createDefaultContext } from "../../src/pipeline/core/context";
import type { AuthService } from "../../src/services/auth-service";
import type { ModelService } from "../../src/services/model-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import { TranscriptionService } from "../../src/services/transcription-service";
import * as fs from "node:fs";

type MockProvider = typeof providerMocks.cloud;
type MockProviderSession = ReturnType<MockProvider["openSession"]>;

interface TestServiceInternals {
  buildContext(): Promise<PipelineContext>;
  applyFormattingAndReplacements(input: { text: string }): Promise<{
    text: string;
    textBeforeReplacements: string;
    formattingUsed: boolean;
  }>;
  readWavAsFloat32(filePath: string): Promise<Float32Array>;
}

const historyRecord = () =>
  ({
    id: 1,
    audioFile: "/tmp/retry.wav",
    text: "",
    detectedLanguage: null,
    language: null,
    meta: {},
  }) as unknown as Awaited<ReturnType<typeof getTranscriptionById>>;

describe("TranscriptionService — provider session pinning", () => {
  let service: TranscriptionService;
  let selectedModelId: string | null;

  const processChunk = (sessionId: string, sample: number) =>
    service.processStreamingChunk({
      sessionId,
      audioChunk: new Float32Array([sample]),
    });

  const sessionFor = (
    provider: MockProvider,
    sessionId: string,
  ): MockProviderSession => {
    const session = provider.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No mock provider session for ${sessionId}`);
    }
    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.local.resetTestState();
    providerMocks.cloud.resetTestState();
    selectedModelId = null;

    const modelService = {
      getSelectedModel: vi.fn(async () => selectedModelId),
    };
    const settingsService = {
      getFormatterConfig: vi.fn(async () => ({ enabled: false })),
    };
    const telemetryService = new Proxy({}, { get: () => vi.fn() });

    service = TranscriptionService.createForTests(
      modelService as unknown as ModelService,
      null as never,
      settingsService as unknown as SettingsService,
      telemetryService as unknown as TelemetryService,
      {
        isAuthenticated: vi.fn(),
        getIdToken: vi.fn(),
        refreshTokenIfNeeded: vi.fn(),
      } as unknown as AuthService,
      null,
      null,
    );
    const serviceInternals = service as unknown as TestServiceInternals;

    vi.spyOn(serviceInternals, "buildContext").mockImplementation(async () =>
      createDefaultContext("retry-session"),
    );
    vi.spyOn(
      serviceInternals,
      "applyFormattingAndReplacements",
    ).mockImplementation(async ({ text }) => ({
      text,
      textBeforeReplacements: text,
      formattingUsed: false,
    }));
    vi.spyOn(serviceInternals, "readWavAsFloat32").mockResolvedValue(
      new Float32Array([0.1]),
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    vi.mocked(getTranscriptionById).mockResolvedValue(historyRecord());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a cloud recording on its original provider after selection changes", async () => {
    providerMocks.cloud.setupSession("cloud-session", (session) => {
      session.transcribe
        .mockResolvedValueOnce({ text: "first" })
        .mockResolvedValueOnce({ text: "first second" });
      session.flush.mockResolvedValueOnce({ text: "first second final" });
    });

    selectedModelId = "amical-cloud";
    await expect(processChunk("cloud-session", 0.1)).resolves.toBe("first");

    selectedModelId = "whisper-tiny";
    await expect(processChunk("cloud-session", 0.2)).resolves.toBe(
      "first second",
    );
    await expect(
      service.finalizeSession({ sessionId: "cloud-session" }),
    ).resolves.toBe("first second final");

    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");
    expect(providerMocks.cloud.openSession).toHaveBeenCalledOnce();
    expect(providerMocks.cloud.openSession).toHaveBeenCalledWith({
      sessionId: "cloud-session",
      modelId: "amical-cloud",
    });
    expect(providerMocks.local.openSession).not.toHaveBeenCalled();
    expect(cloudSession.transcribe).toHaveBeenCalledTimes(2);
    expect(cloudSession.flush).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregatedTranscription: "first second",
      }),
      expect.any(AbortSignal),
    );
    expect(cloudSession.cancel).toHaveBeenCalledOnce();
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith(
      expect.objectContaining({ speechModel: "amical-cloud" }),
    );
  });

  it("keeps a local recording and model pinned after selection changes", async () => {
    selectedModelId = "whisper-tiny";
    await processChunk("local-session", 0.1);

    selectedModelId = "amical-cloud";
    await processChunk("local-session", 0.2);
    await service.finalizeSession({ sessionId: "local-session" });

    const localSession = sessionFor(providerMocks.local, "local-session");
    expect(providerMocks.local.openSession).toHaveBeenCalledOnce();
    expect(providerMocks.local.openSession).toHaveBeenCalledWith({
      sessionId: "local-session",
      modelId: "whisper-tiny",
    });
    expect(providerMocks.cloud.openSession).not.toHaveBeenCalled();
    expect(localSession.transcribe).toHaveBeenCalledTimes(2);
    expect(localSession.flush).toHaveBeenCalledOnce();
    expect(localSession.cancel).toHaveBeenCalledOnce();
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith(
      expect.objectContaining({ speechModel: "whisper-tiny" }),
    );
  });

  it("routes updates to the pinned session without blocking cancellation", async () => {
    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let markUpdateStarted!: () => void;
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve;
    });
    providerMocks.cloud.setupSession("cloud-session", (session) => {
      session.updateSessionContext.mockImplementation(async () => {
        markUpdateStarted();
        await updateGate;
      });
    });

    selectedModelId = "amical-cloud";
    await processChunk("cloud-session", 0.1);
    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");

    selectedModelId = "whisper-tiny";
    await service.warmupActiveProvider();
    const updatePromise = service.updateStreamingSession({
      sessionId: "cloud-session",
      accessibilityContext: null,
    });
    await updateStarted;

    const cancelPromise = service.cancelStreamingSession("cloud-session");
    await cancelPromise;
    expect(cloudSession.cancel).toHaveBeenCalledOnce();

    releaseUpdate();
    await updatePromise;

    expect(providerMocks.local.warmup).toHaveBeenCalledOnce();
    expect(cloudSession.updateSessionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "cloud-session",
        accessibilityContext: null,
      }),
    );
    expect(providerMocks.local.openSession).not.toHaveBeenCalled();
    expect(providerMocks.local.updateSessionContext).not.toHaveBeenCalled();
    expect(providerMocks.cloud.updateSessionContext).not.toHaveBeenCalled();
    expect(providerMocks.local.reset).not.toHaveBeenCalled();
    expect(providerMocks.cloud.reset).not.toHaveBeenCalled();
  });

  it("retires live provider sessions when the service is disposed", async () => {
    selectedModelId = "whisper-tiny";
    await processChunk("local-session", 0.1);
    const localSession = sessionFor(providerMocks.local, "local-session");

    await service.dispose();

    expect(localSession.cancel).toHaveBeenCalledOnce();
    expect(providerMocks.local.dispose).toHaveBeenCalledOnce();
    expect(providerMocks.cloud.dispose).toHaveBeenCalledOnce();
  });

  it("uses and retires one explicit provider session for History retry", async () => {
    selectedModelId = "whisper-tiny";

    expect((await service.retryTranscription(1)).trim()).toBe("local final");

    const retrySession = sessionFor(providerMocks.local, "retry-session");
    expect(providerMocks.local.openSession).toHaveBeenCalledOnce();
    expect(providerMocks.local.openSession).toHaveBeenCalledWith({
      sessionId: "retry-session",
      modelId: "whisper-tiny",
    });
    expect(retrySession.transcribe).toHaveBeenCalledOnce();
    expect(retrySession.flush).toHaveBeenCalledOnce();
    expect(retrySession.cancel).toHaveBeenCalledOnce();
    expect(providerMocks.local.reset).not.toHaveBeenCalled();
    expect(providerMocks.local.transcribe).not.toHaveBeenCalled();
    expect(providerMocks.local.flush).not.toHaveBeenCalled();
    expect(vi.mocked(updateTranscription)).toHaveBeenCalledOnce();
  });

  it("retires the History provider session when transcription fails", async () => {
    selectedModelId = "whisper-tiny";
    const failure = new Error("decode failed");
    providerMocks.local.setupSession("retry-session", (session) => {
      session.transcribe.mockRejectedValueOnce(failure);
    });

    await expect(service.retryTranscription(1)).rejects.toBe(failure);

    const retrySession = sessionFor(providerMocks.local, "retry-session");
    expect(retrySession.cancel).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTranscription)).not.toHaveBeenCalled();
  });
});
