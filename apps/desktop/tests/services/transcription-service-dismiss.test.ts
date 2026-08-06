import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB writes so we can assert calls without a real database. (The
// global setup mocks `@db`; here we mock the higher-level write helpers that
// finalizeSession calls so a dismissed/normal row is observable as a call.)
vi.mock("../../src/db/transcriptions", () => ({
  createTranscription: vi.fn(async () => "txn-id"),
  updateTranscription: vi.fn(async () => undefined),
}));
vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

const prepareTranscriptText = vi.hoisted(() => vi.fn());
vi.mock(
  "../../src/services/transcription/prepare-transcript-text",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/transcription/prepare-transcript-text")
    >()),
    prepareTranscriptText,
  }),
);

// The real providers are never exercised here because each test injects a fake
// provider session, so stub their modules to keep construction trivial and free
// of grpc/auth import side effects.
vi.mock("../../src/pipeline/providers/transcription/whisper-provider", () => ({
  WhisperProvider: vi.fn(function () {
    return {
      name: "whisper-local",
      openSession: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
  }),
}));
vi.mock(
  "../../src/pipeline/providers/transcription/amical-cloud-provider",
  () => ({
    AmicalCloudProvider: vi.fn(function () {
      return {
        name: "amical-cloud",
        openSession: vi.fn(),
        warmup: vi.fn(),
        dispose: vi.fn(async () => undefined),
      };
    }),
  }),
);

import { TranscriptionService } from "../../src/services/transcription-service";
import { createTranscription } from "../../src/db/transcriptions";
import { incrementDailyStats } from "../../src/db/daily-stats";
import { ErrorCodes, AppError } from "../../src/types/error";
import type {
  DictationContext,
  MaterializedTranscriptionSession,
} from "../../src/services/transcription/types";

const makeProvider = () => ({
  name: "fake-local",
  sessionId: "s1",
  transcribe: vi.fn(async () => ({ text: "" })),
  flush: vi.fn(async () => ({ text: " world" })),
  cancel: vi.fn(),
  updateSessionContext: vi.fn(async () => undefined),
});

describe("TranscriptionService — dismiss (finalizeSession gates)", () => {
  let svc: any;
  let provider: ReturnType<typeof makeProvider>;
  let applyFmt: typeof prepareTranscriptText;
  let trackTranscriptionCompleted: ReturnType<typeof vi.fn>;

  // Inject a valid materialized session directly, bypassing
  // processStreamingChunk/context loading.
  const seedSession = (
    sessionId: string,
    contextOverrides: Partial<DictationContext> = {},
  ): MaterializedTranscriptionSession => {
    provider.sessionId = sessionId;
    const session: MaterializedTranscriptionSession = {
      context: {
        sessionId,
        vocabulary: [],
        replacements: new Map(),
        formattingStyle: "formal",
        audio: { source: "microphone" },
        accessibilityContext: null,
        cloudFormattingEnabled: false,
        isInstruct: false,
        ...contextOverrides,
      },
      providerSession: provider,
      speechModelId: "fake-local-model",
      transcriptionResults: ["hello"],
      firstChunkReceivedAt: 1,
      recordingStartedAt: 0,
    };
    svc.beginStreamingSession(sessionId);
    svc.activeLiveSession.attach(session);
    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const modelService = { getSelectedModel: vi.fn(async () => undefined) };
    trackTranscriptionCompleted = vi.fn();
    const telemetryService = new Proxy(
      { trackTranscriptionCompleted },
      { get: (target, property) => Reflect.get(target, property) ?? vi.fn() },
    );
    const settingsService = new Proxy(
      {},
      { get: () => vi.fn(async () => undefined) },
    );
    svc = TranscriptionService.createForTests(
      modelService as any,
      null as any,
      settingsService as any,
      telemetryService as any,
      {
        isAuthenticated: vi.fn(),
        getIdToken: vi.fn(),
        refreshTokenIfNeeded: vi.fn(),
      } as any,
      null,
      null,
    );
    provider = makeProvider();
    // Stub formatting (a possibly-remote LLM call) so the success/late-dismiss
    // paths are deterministic; individual tests assert whether it ran.
    prepareTranscriptText.mockResolvedValue({
      text: "hello world",
      language: "auto",
      wordCount: 2,
      formattingUsed: false,
    });
    applyFmt = prepareTranscriptText;
  });

  it("early dismiss (before flush): throws USER_DISMISSED, skips the flush, writes a dismissed row", async () => {
    seedSession("s1");
    svc.abortSession("s1");

    await expect(
      svc.finalizeSession({ sessionId: "s1", audioFilePath: "/tmp/a.wav" }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.USER_DISMISSED });

    expect(provider.flush).not.toHaveBeenCalled();
    expect(vi.mocked(createTranscription)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith({
      text: "",
      audioFile: "/tmp/a.wav",
      meta: { sessionId: "s1", status: "dismissed" },
    });
    expect(vi.mocked(incrementDailyStats)).not.toHaveBeenCalled();
    expect(provider.cancel).toHaveBeenCalledOnce();
    // Final cleanup removes the session.
    expect(svc.activeLiveSession).toBeNull();
  });

  it("a flush rejected by the dismiss-cancel becomes a silent dismissed row, not a failed one", async () => {
    seedSession("s1");
    provider.flush.mockImplementation(async () => {
      // Dismiss lands mid-flush; provider-session cancellation rejects the flush.
      svc.abortSession("s1");
      throw new AppError("cancelled", ErrorCodes.NETWORK_ERROR);
    });

    await expect(
      svc.finalizeSession({ sessionId: "s1", audioFilePath: "/tmp/a.wav" }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.USER_DISMISSED });

    expect(provider.flush).toHaveBeenCalledTimes(1);
    expect(applyFmt).not.toHaveBeenCalled();
    expect(vi.mocked(createTranscription)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        meta: expect.objectContaining({ sessionId: "s1", status: "dismissed" }),
      }),
    );
    // NOT the failed-transcription branch: no failed row, no stats bump.
    expect(vi.mocked(incrementDailyStats)).not.toHaveBeenCalled();
    expect(provider.cancel).toHaveBeenCalledOnce();
    expect(svc.activeLiveSession).toBeNull();
  });

  it("post-flush dismiss (non-interruptible provider): discards the transcript instead of pasting", async () => {
    seedSession("s1");
    provider.flush.mockImplementation(async () => {
      // Dismiss landed during a decode that couldn't be interrupted; the flush
      // still returns a transcript, which the post-flush gate must discard.
      svc.abortSession("s1");
      return { text: " world" };
    });

    await expect(
      svc.finalizeSession({ sessionId: "s1", audioFilePath: "/tmp/a.wav" }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.USER_DISMISSED });

    expect(provider.flush).toHaveBeenCalledTimes(1);
    // Post-flush gate fires before formatting.
    expect(applyFmt).not.toHaveBeenCalled();
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ status: "dismissed" }),
      }),
    );
    expect(vi.mocked(incrementDailyStats)).not.toHaveBeenCalled();
    expect(provider.cancel).toHaveBeenCalledOnce();
  });

  it("late dismiss during formatting: the final gate discards the formatted transcript", async () => {
    seedSession("s1");
    provider.flush.mockResolvedValue({ text: " world" });
    applyFmt.mockImplementation(async ({ text }: { text: string }) => {
      // Dismiss while the (possibly-remote) formatting call is in flight.
      svc.abortSession("s1");
      return {
        text,
        language: "auto",
        wordCount: 2,
        formattingUsed: false,
      };
    });

    await expect(
      svc.finalizeSession({ sessionId: "s1", audioFilePath: "/tmp/a.wav" }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.USER_DISMISSED });

    // Formatting ran...
    expect(applyFmt).toHaveBeenCalledTimes(1);
    // ...but the committed row is dismissed, not the formatted transcript.
    expect(vi.mocked(createTranscription)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        meta: expect.objectContaining({ status: "dismissed" }),
      }),
    );
    expect(vi.mocked(incrementDailyStats)).not.toHaveBeenCalled();
    expect(provider.cancel).toHaveBeenCalledOnce();
  });

  it("no dismiss (control): finalize writes a normal row, increments stats, returns the transcript", async () => {
    seedSession("s1");
    provider.flush.mockResolvedValue({ text: " world" });

    const result = await svc.finalizeSession({
      sessionId: "s1",
      audioFilePath: "/tmp/a.wav",
    });

    // Boundary normalization may pad whitespace; the point is a real transcript.
    expect(result.trim()).toBe("hello world");
    const arg = vi.mocked(createTranscription).mock.calls[0]![0] as any;
    expect(arg.text.trim()).toBe("hello world");
    expect(arg.meta?.status).not.toBe("dismissed");
    expect(vi.mocked(incrementDailyStats)).toHaveBeenCalledTimes(1);
    expect(provider.cancel).toHaveBeenCalledOnce();
  });

  it("maps the live context into persistence and completion telemetry", async () => {
    seedSession("s1", {
      vocabulary: ["Amical", "Zeus"],
      languages: ["de"],
      formattingStyle: "technical",
      audio: { source: "file", duration: 2.5 },
    });
    provider.flush.mockResolvedValue({ text: " world" });
    applyFmt.mockResolvedValue({
      text: "hello world",
      language: "de",
      detectedLanguage: "de",
      wordCount: 2,
      formattingUsed: false,
    });

    await svc.finalizeSession({ sessionId: "s1", audioFilePath: "/tmp/a.wav" });

    expect(createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello world",
        language: "de",
        detectedLanguage: "de",
        duration: 2.5,
        meta: expect.objectContaining({
          source: "file",
          vocabularySize: 2,
          formattingStyle: "technical",
        }),
      }),
    );
    expect(trackTranscriptionCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        audio_duration_seconds: 2.5,
        languages: ["de"],
        vocabulary_size: 2,
      }),
    );
  });

  it("a provider failure writes a failed row and retires the session", async () => {
    seedSession("s1");
    const failure = new AppError(
      "local decode failed",
      ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
    );
    provider.flush.mockRejectedValue(failure);

    await expect(
      svc.finalizeSession({ sessionId: "s1", audioFilePath: "/tmp/a.wav" }),
    ).rejects.toBe(failure);

    expect(applyFmt).not.toHaveBeenCalled();
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        meta: expect.objectContaining({
          sessionId: "s1",
          status: "failed",
          failureReason: ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
        }),
      }),
    );
    expect(provider.cancel).toHaveBeenCalledOnce();
    expect(svc.activeLiveSession).toBeNull();
  });

  it("saveDismissedTranscription writes empty text + dismissed status + the audio file", async () => {
    await svc.saveDismissedTranscription({
      sessionId: "s9",
      audioFilePath: "/tmp/x.wav",
    });
    expect(vi.mocked(createTranscription)).toHaveBeenCalledWith({
      text: "",
      audioFile: "/tmp/x.wav",
      meta: { sessionId: "s9", status: "dismissed" },
    });
  });

  it("abortSession is lookup-only: no-op for an unknown session, aborts an existing one", () => {
    expect(() => svc.abortSession("does-not-exist")).not.toThrow();

    seedSession("s2");
    expect(svc.activeLiveSession.signal.aborted).toBe(false);
    svc.abortSession("s2");
    expect(svc.activeLiveSession.signal.aborted).toBe(true);
  });
});
