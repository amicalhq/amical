import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenTranscriptionSessionOptions,
  TranscribeContext,
  TranscribeParams,
  TranscriptionOutput,
} from "../../src/pipeline/core/pipeline-types";
import { AppError, ErrorCodes } from "../../src/types/error";

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
    emitTerminalFailure: (error: Error) => options.onTerminalFailure?.(error),
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
      warmup: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      preloadModel: vi.fn(async () => undefined),
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
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

vi.mock("../../src/services/transcription/load-dictation-context", () => ({
  loadDictationContext: vi.fn(),
}));

vi.mock(
  "../../src/services/transcription/prepare-transcript-text",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/transcription/prepare-transcript-text")
    >()),
    prepareTranscriptText: vi.fn(),
  }),
);

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
  getTranscriptionById,
  updateTranscription,
} from "../../src/db/transcriptions";
import type { AuthService } from "../../src/services/auth-service";
import type { ModelService } from "../../src/services/model-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import { TranscriptionService } from "../../src/services/transcription-service";
import { loadDictationContext } from "../../src/services/transcription/load-dictation-context";
import { prepareTranscriptText } from "../../src/services/transcription/prepare-transcript-text";
import type { DictationContext } from "../../src/services/transcription/types";
import type { VADService } from "../../src/services/vad-service";
import * as fs from "node:fs";

type MockProvider = typeof providerMocks.cloud;
type MockProviderSession = ReturnType<MockProvider["openSession"]>;

const dictationContext = (sessionId: string): DictationContext => ({
  sessionId,
  vocabulary: [],
  replacements: new Map(),
  formattingStyle: "formal",
  audio: { source: "microphone" },
  accessibilityContext: null,
  cloudFormattingEnabled: false,
  isInstruct: false,
});

const historyRecord = () =>
  ({
    id: 1,
    audioFile: "/tmp/retry.wav",
    text: "",
    detectedLanguage: null,
    language: null,
    meta: {},
  }) as unknown as Awaited<ReturnType<typeof getTranscriptionById>>;

const deferred = <T>() => {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
};

describe("TranscriptionService — provider session pinning", () => {
  let service: TranscriptionService;
  let selectedModelId: string | null;
  let processVadFrame: ReturnType<typeof vi.fn>;

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
    processVadFrame = vi.fn(async () => ({
      probability: 1,
      isSpeaking: true,
    }));

    service = TranscriptionService.createForTests(
      modelService as unknown as ModelService,
      {
        processAudioFrame: processVadFrame,
        reset: vi.fn(),
      } as unknown as VADService,
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
    vi.mocked(loadDictationContext).mockImplementation(async (options) =>
      dictationContext(options.sessionId ?? "retry-session"),
    );
    vi.mocked(prepareTranscriptText).mockImplementation(
      async ({ text, context, detectedLanguage }) => ({
        text,
        language:
          context.languages?.length === 1 ? context.languages[0] : "auto",
        detectedLanguage: detectedLanguage?.trim() || undefined,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        formattingUsed: false,
      }),
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    const wav = Buffer.alloc(46);
    wav.writeInt16LE(3277, 44);
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(wav);
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
    service.beginStreamingSession("cloud-session");
    await expect(processChunk("cloud-session", 0.1)).resolves.toBe("first");

    selectedModelId = "whisper-tiny";
    await expect(processChunk("cloud-session", 0.2)).resolves.toBe(
      "first second",
    );
    await expect(
      service.resolveStreamingSession({ sessionId: "cloud-session" }),
    ).resolves.toMatchObject({
      text: "first second final",
      speechModel: "amical-cloud",
    });

    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");
    expect(providerMocks.cloud.openSession).toHaveBeenCalledOnce();
    expect(providerMocks.cloud.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "cloud-session",
        modelId: "amical-cloud",
      }),
    );
    expect(providerMocks.local.openSession).not.toHaveBeenCalled();
    expect(cloudSession.transcribe).toHaveBeenCalledTimes(2);
    expect(cloudSession.flush).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregatedTranscription: "first second",
      }),
      expect.any(AbortSignal),
    );
    expect(cloudSession.cancel).toHaveBeenCalledOnce();
  });

  it("keeps a local recording and model pinned after selection changes", async () => {
    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("local-session");
    await processChunk("local-session", 0.1);

    selectedModelId = "amical-cloud";
    await processChunk("local-session", 0.2);
    const resolvedSession = await service.resolveStreamingSession({
      sessionId: "local-session",
    });
    expect(resolvedSession).toMatchObject({ speechModel: "whisper-tiny" });

    const localSession = sessionFor(providerMocks.local, "local-session");
    expect(providerMocks.local.openSession).toHaveBeenCalledOnce();
    expect(providerMocks.local.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "local-session",
        modelId: "whisper-tiny",
      }),
    );
    expect(providerMocks.cloud.openSession).not.toHaveBeenCalled();
    expect(localSession.transcribe).toHaveBeenCalledTimes(2);
    expect(localSession.flush).toHaveBeenCalledOnce();
    expect(localSession.cancel).toHaveBeenCalledOnce();
  });

  it("drains audio admitted in VAD before the final provider flush", async () => {
    const secondVadStarted = deferred<void>();
    const secondVad = deferred<{ probability: number; isSpeaking: boolean }>();
    processVadFrame
      .mockResolvedValueOnce({ probability: 1, isSpeaking: true })
      .mockImplementationOnce(async () => {
        secondVadStarted.resolve();
        return secondVad.promise;
      });
    providerMocks.local.setupSession("local-session", (session) => {
      session.transcribe
        .mockResolvedValueOnce({ text: "first" })
        .mockResolvedValueOnce({ text: " second" });
      session.flush.mockResolvedValueOnce({ text: " final" });
    });

    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("local-session");
    await processChunk("local-session", 0.1);

    const secondChunk = processChunk("local-session", 0.2);
    await secondVadStarted.promise;
    const finalization = service.resolveStreamingSession({
      sessionId: "local-session",
    });

    const localSession = sessionFor(providerMocks.local, "local-session");
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(localSession.flush).not.toHaveBeenCalled();

      secondVad.resolve({ probability: 1, isSpeaking: true });
      await expect(secondChunk).resolves.toBe("first second");
      expect((await finalization)?.text.trim()).toBe("first second final");

      expect(localSession.flush).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregatedTranscription: "first second",
        }),
        expect.any(AbortSignal),
      );
      expect(localSession.cancel).toHaveBeenCalledOnce();
    } finally {
      secondVad.resolve({ probability: 1, isSpeaking: true });
      await Promise.allSettled([secondChunk, finalization]);
    }
  });

  it("keeps a newer pre-open context update ahead of an admitted chunk", async () => {
    const vadStarted = deferred<void>();
    const vadGate = deferred<{ probability: number; isSpeaking: boolean }>();
    processVadFrame.mockImplementationOnce(async () => {
      vadStarted.resolve();
      return vadGate.promise;
    });
    const accessibilityContext = { context: null };

    selectedModelId = "amical-cloud";
    service.beginStreamingSession("cloud-session");
    const chunk = service.processStreamingChunk({
      sessionId: "cloud-session",
      audioChunk: new Float32Array([0.1]),
      isInstruct: false,
    });
    await vadStarted.promise;

    await service.updateStreamingSession({
      sessionId: "cloud-session",
      accessibilityContext,
      isInstruct: true,
    });
    expect(providerMocks.cloud.openSession).not.toHaveBeenCalled();

    try {
      vadGate.resolve({ probability: 1, isSpeaking: true });
      await chunk;

      const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");
      expect(cloudSession.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            accessibilityContext,
            isInstruct: true,
          }),
        }),
      );
      expect(cloudSession.updateSessionContext).not.toHaveBeenCalled();

      await service.resolveStreamingSession({ sessionId: "cloud-session" });
      expect(cloudSession.flush).toHaveBeenCalledWith(
        expect.objectContaining({
          accessibilityContext,
          isInstruct: true,
        }),
        expect.any(AbortSignal),
      );
    } finally {
      vadGate.resolve({ probability: 1, isSpeaking: true });
      await Promise.allSettled([chunk]);
    }
  });

  it("closes chunk admission synchronously when finalization is claimed", async () => {
    const flushStarted = deferred<void>();
    const flushGate = deferred<void>();
    providerMocks.local.setupSession("local-session", (session) => {
      session.flush.mockImplementationOnce(async () => {
        flushStarted.resolve();
        await flushGate.promise;
        return { text: " final" };
      });
    });

    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("local-session");
    await processChunk("local-session", 0.1);
    const localSession = sessionFor(providerMocks.local, "local-session");

    const finalization = service.resolveStreamingSession({
      sessionId: "local-session",
    });
    try {
      await expect(processChunk("local-session", 0.2)).resolves.toBe("");
      expect(processVadFrame).toHaveBeenCalledOnce();
      expect(localSession.transcribe).toHaveBeenCalledOnce();

      await flushStarted.promise;
      flushGate.resolve();
      await finalization;

      await expect(processChunk("local-session", 0.3)).resolves.toBe("");
      expect(processVadFrame).toHaveBeenCalledOnce();
      expect(providerMocks.local.openSession).toHaveBeenCalledOnce();
    } finally {
      flushGate.resolve();
    }
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
    service.beginStreamingSession("cloud-session");
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
  });

  it("does not start a queued context push after cancellation", async () => {
    selectedModelId = "amical-cloud";
    service.beginStreamingSession("cloud-session");
    await processChunk("cloud-session", 0.1);
    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");

    const update = service.updateStreamingSession({
      sessionId: "cloud-session",
      isInstruct: true,
    });
    const cancellation = service.cancelStreamingSession("cloud-session");

    expect(cloudSession.cancel).toHaveBeenCalledOnce();
    await Promise.all([update, cancellation]);
    await Promise.resolve();
    expect(cloudSession.updateSessionContext).not.toHaveBeenCalled();
  });

  it("does not let a hanging context push block audio or finalization", async () => {
    const updateStarted = deferred<void>();
    const updateGate = deferred<void>();
    providerMocks.cloud.setupSession("cloud-session", (session) => {
      session.transcribe
        .mockResolvedValueOnce({ text: "first" })
        .mockResolvedValueOnce({ text: "first second" });
      session.flush.mockResolvedValueOnce({ text: "first second final" });
      session.updateSessionContext.mockImplementationOnce(async () => {
        updateStarted.resolve();
        await updateGate.promise;
      });
    });

    selectedModelId = "amical-cloud";
    service.beginStreamingSession("cloud-session");
    await processChunk("cloud-session", 0.1);
    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");

    try {
      await service.updateStreamingSession({
        sessionId: "cloud-session",
        isInstruct: true,
      });
      await updateStarted.promise;

      await expect(processChunk("cloud-session", 0.2)).resolves.toBe(
        "first second",
      );
      await expect(
        service.resolveStreamingSession({ sessionId: "cloud-session" }),
      ).resolves.toMatchObject({ text: "first second final" });

      expect(cloudSession.transcribe).toHaveBeenLastCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ isInstruct: true }),
        }),
      );
      expect(cloudSession.flush).toHaveBeenCalledWith(
        expect.objectContaining({ isInstruct: true }),
        expect.any(AbortSignal),
      );
      expect(cloudSession.cancel).toHaveBeenCalledOnce();
    } finally {
      updateGate.resolve();
    }
  });

  it("cancels in-flight provider work immediately and rejects late chunks", async () => {
    const transcribeStarted = deferred<void>();
    const transcribeGate = deferred<void>();
    providerMocks.local.setupSession("local-session", (session) => {
      session.transcribe.mockImplementationOnce(async () => {
        transcribeStarted.resolve();
        await transcribeGate.promise;
        return { text: "late" };
      });
    });

    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("local-session");
    const inFlightChunk = processChunk("local-session", 0.1);
    await transcribeStarted.promise;
    const localSession = sessionFor(providerMocks.local, "local-session");

    try {
      const cancellation = service.cancelStreamingSession("local-session");
      expect(localSession.cancel).toHaveBeenCalledOnce();

      await expect(processChunk("local-session", 0.2)).resolves.toBe("");
      expect(processVadFrame).toHaveBeenCalledOnce();
      await cancellation;

      transcribeGate.resolve();
      await expect(inFlightChunk).resolves.toBe("");
      await expect(processChunk("local-session", 0.3)).resolves.toBe("");

      expect(providerMocks.local.openSession).toHaveBeenCalledOnce();
      expect(localSession.transcribe).toHaveBeenCalledOnce();
      expect(localSession.cancel).toHaveBeenCalledOnce();
    } finally {
      transcribeGate.resolve();
    }
  });

  it("cancellation during VAD cannot materialize or recreate a provider session", async () => {
    const vadStarted = deferred<void>();
    const vadGate = deferred<{ probability: number; isSpeaking: boolean }>();
    processVadFrame.mockImplementationOnce(async () => {
      vadStarted.resolve();
      return vadGate.promise;
    });

    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("local-session");
    const inFlightChunk = processChunk("local-session", 0.1);
    await vadStarted.promise;

    try {
      const cancellation = service.cancelStreamingSession("local-session");
      expect(providerMocks.local.openSession).not.toHaveBeenCalled();

      await expect(processChunk("local-session", 0.2)).resolves.toBe("");
      await cancellation;
      vadGate.resolve({ probability: 1, isSpeaking: true });
      await expect(inFlightChunk).resolves.toBe("");
      await expect(processChunk("local-session", 0.3)).resolves.toBe("");

      expect(providerMocks.local.openSession).not.toHaveBeenCalled();
      expect(processVadFrame).toHaveBeenCalledOnce();
    } finally {
      vadGate.resolve({ probability: 1, isSpeaking: true });
    }
  });

  it("rejects chunks from a retired session while a new session is active", async () => {
    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("old-session");
    await service.cancelStreamingSession("old-session");

    service.beginStreamingSession("current-session");
    await processChunk("current-session", 0.1);
    const currentSession = sessionFor(providerMocks.local, "current-session");

    await expect(processChunk("old-session", 0.2)).resolves.toBe("");
    expect(processVadFrame).toHaveBeenCalledOnce();
    expect(currentSession.transcribe).toHaveBeenCalledOnce();
    expect(providerMocks.local.openSession).toHaveBeenCalledOnce();

    await service.cancelStreamingSession("current-session");
  });

  it("retires a reserved session that resolves without any chunks", async () => {
    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("empty-session");

    await expect(
      service.resolveStreamingSession({ sessionId: "empty-session" }),
    ).resolves.toBeNull();
    expect(providerMocks.local.openSession).not.toHaveBeenCalled();
    expect(processVadFrame).not.toHaveBeenCalled();
    await expect(processChunk("empty-session", 0.1)).resolves.toBe("");
    expect(processVadFrame).not.toHaveBeenCalled();

    expect(() => service.beginStreamingSession("next-session")).not.toThrow();
    await service.cancelStreamingSession("next-session");
  });

  it("retires live provider sessions when the service is disposed", async () => {
    selectedModelId = "whisper-tiny";
    service.beginStreamingSession("local-session");
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

    expect(service.beginStreamingSession("after-failed-retry")).toBe(true);
    await service.cancelStreamingSession("after-failed-retry");
  });

  it("keeps live admission blocked until retry persistence completes", async () => {
    selectedModelId = "whisper-tiny";
    const persistence =
      deferred<Awaited<ReturnType<typeof updateTranscription>>>();
    vi.mocked(updateTranscription).mockImplementationOnce(
      async () => persistence.promise,
    );

    const retry = service.retryTranscription(1);
    await vi.waitFor(() => {
      expect(updateTranscription).toHaveBeenCalledOnce();
    });

    expect(service.beginStreamingSession("blocked-during-persistence")).toBe(
      false,
    );

    persistence.resolve(
      historyRecord() as Awaited<ReturnType<typeof updateTranscription>>,
    );
    await retry;

    expect(service.beginStreamingSession("after-persistence")).toBe(true);
    await service.cancelStreamingSession("after-persistence");
  });

  it("I-51: latches and reports the first terminal failure for the active live session", async () => {
    selectedModelId = "amical-cloud";
    const listener = vi.fn();
    expect(service.beginStreamingSession("cloud-session", listener)).toBe(true);
    await processChunk("cloud-session", 0.1);
    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");
    const terminalError = new AppError(
      "Cloud quota exhausted",
      ErrorCodes.QUOTA_EXCEEDED,
    );

    cloudSession.emitTerminalFailure(terminalError);
    cloudSession.emitTerminalFailure(
      new AppError("Later failure", ErrorCodes.RATE_LIMIT_EXCEEDED),
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(terminalError);
    // Self-retired on the terminal report: nothing left to resolve, and the
    // slot is free for a successor.
    await expect(
      service.resolveStreamingSession({ sessionId: "cloud-session" }),
    ).resolves.toBeNull();
    expect(cloudSession.flush).not.toHaveBeenCalled();
    expect(cloudSession.cancel).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTranscription)).not.toHaveBeenCalled();
    expect(service.beginStreamingSession("successor")).toBe(true);
    await service.cancelStreamingSession("successor");
  });

  it("I-51: projects a rejected provider chunk as one terminal session failure", async () => {
    const terminalError = new AppError(
      "HTTP fallback failed",
      ErrorCodes.INTERNAL_SERVER_ERROR,
      { httpStatus: 500 },
    );
    providerMocks.cloud.setupSession("cloud-session", (session) => {
      session.transcribe.mockRejectedValueOnce(terminalError);
    });
    selectedModelId = "amical-cloud";
    const listener = vi.fn();
    expect(service.beginStreamingSession("cloud-session", listener)).toBe(true);

    await expect(processChunk("cloud-session", 0.1)).rejects.toBe(
      terminalError,
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(terminalError);
    const cloudSession = sessionFor(providerMocks.cloud, "cloud-session");
    await expect(
      service.resolveStreamingSession({ sessionId: "cloud-session" }),
    ).resolves.toBeNull();
    expect(cloudSession.flush).not.toHaveBeenCalled();
  });

  it("surfaces a terminal failure that occurs before provider materialization", async () => {
    selectedModelId = "amical-cloud";
    const terminalError = new Error("Context lookup failed");
    vi.mocked(loadDictationContext).mockRejectedValueOnce(terminalError);
    const listener = vi.fn();
    expect(service.beginStreamingSession("cloud-session", listener)).toBe(true);

    await expect(processChunk("cloud-session", 0.1)).rejects.toBe(
      terminalError,
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(terminalError);

    await expect(
      service.resolveStreamingSession({ sessionId: "cloud-session" }),
    ).resolves.toBeNull();
    expect(providerMocks.cloud.openSession).not.toHaveBeenCalled();
    expect(vi.mocked(updateTranscription)).not.toHaveBeenCalled();
  });

  it("ignores a retired session callback while a newer live session is active", async () => {
    selectedModelId = "amical-cloud";
    const oldListener = vi.fn();
    expect(service.beginStreamingSession("old-session", oldListener)).toBe(
      true,
    );
    await processChunk("old-session", 0.1);
    const oldSession = sessionFor(providerMocks.cloud, "old-session");
    await service.cancelStreamingSession("old-session");

    const currentListener = vi.fn();
    expect(
      service.beginStreamingSession("current-session", currentListener),
    ).toBe(true);
    await processChunk("current-session", 0.2);
    const currentSession = sessionFor(providerMocks.cloud, "current-session");

    oldSession.emitTerminalFailure(
      new AppError("Late old failure", ErrorCodes.QUOTA_EXCEEDED),
    );

    expect(oldListener).not.toHaveBeenCalled();
    expect(currentListener).not.toHaveBeenCalled();
    await expect(
      service.resolveStreamingSession({ sessionId: "current-session" }),
    ).resolves.toMatchObject({ text: "cloud final" });
    expect(currentSession.flush).toHaveBeenCalledOnce();
    expect(currentSession.cancel).toHaveBeenCalledOnce();
  });

  it("excludes live recording and History retry in both directions", async () => {
    selectedModelId = "whisper-tiny";
    expect(service.beginStreamingSession("live-session")).toBe(true);

    await expect(service.retryTranscription(1)).rejects.toThrow(
      "Cannot retry while recording is in progress",
    );
    expect(vi.mocked(getTranscriptionById)).not.toHaveBeenCalled();
    await service.cancelStreamingSession("live-session");

    const lookup = deferred<Awaited<ReturnType<typeof getTranscriptionById>>>();
    vi.mocked(getTranscriptionById).mockImplementationOnce(
      async () => lookup.promise,
    );
    const retry = service.retryTranscription(1);

    expect(service.beginStreamingSession("blocked-live-session")).toBe(false);
    await expect(service.retryTranscription(2)).rejects.toThrow(
      "Another transcription retry is already in progress",
    );
    expect(vi.mocked(getTranscriptionById)).toHaveBeenCalledOnce();

    lookup.resolve(historyRecord());
    expect((await retry).trim()).toBe("local final");

    expect(service.beginStreamingSession("next-live-session")).toBe(true);
    await service.cancelStreamingSession("next-live-session");
  });
});
