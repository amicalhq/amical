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

// The real providers are never exercised here (selectProvider is overridden to
// return a fake), so stub their modules to keep construction trivial and free of
// grpc/auth import side effects.
vi.mock("../../src/pipeline/providers/transcription/whisper-provider", () => ({
  WhisperProvider: vi.fn(function () {
    return {
      name: "whisper-local",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
    };
  }),
}));
vi.mock("../../src/pipeline/providers/transcription/amical-cloud-provider", () => ({
  AmicalCloudProvider: vi.fn(function () {
    return {
      name: "amical-cloud",
      transcribe: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
      warmup: vi.fn(),
    };
  }),
}));

import { TranscriptionService } from "../../src/services/transcription-service";
import { createTranscription } from "../../src/db/transcriptions";
import { incrementDailyStats } from "../../src/db/daily-stats";
import { createDefaultContext } from "../../src/pipeline/core/context";
import { ErrorCodes, AppError } from "../../src/types/error";
import type { StreamingSession } from "../../src/pipeline/core/pipeline-types";

const makeProvider = () => ({
  name: "fake-local",
  transcribe: vi.fn(async () => ({ text: "" })),
  flush: vi.fn(async () => ({ text: " world" })),
  reset: vi.fn(),
});

describe("TranscriptionService — dismiss (finalizeSession gates)", () => {
  let svc: any;
  let provider: ReturnType<typeof makeProvider>;
  let applyFmt: ReturnType<typeof vi.spyOn>;

  // Inject a valid streaming session (with its on-session aborter) directly,
  // bypassing processStreamingChunk/buildContext.
  const seedSession = (sessionId: string): StreamingSession => {
    const base = createDefaultContext(sessionId);
    const context: any = {
      ...base,
      sessionId,
      isPartial: true,
      isFinal: false,
      accumulatedTranscription: [],
    };
    context.metadata.set("cloudFormattingEnabled", false);
    const session: StreamingSession = {
      context,
      transcriptionResults: ["hello"],
      firstChunkReceivedAt: 1,
      recordingStartedAt: 0,
      abortController: new AbortController(),
    };
    svc.streamingSessions.set(sessionId, session);
    return session;
  };

  beforeEach(() => {
    const modelService = { getSelectedModel: vi.fn(async () => undefined) };
    const telemetryService = new Proxy({}, { get: () => vi.fn() });
    const settingsService = new Proxy(
      {},
      { get: () => vi.fn(async () => undefined) },
    );
    svc = new TranscriptionService(
      modelService as any,
      null as any,
      settingsService as any,
      telemetryService as any,
      null,
      null,
    );
    provider = makeProvider();
    vi.spyOn(svc, "selectProvider").mockResolvedValue(provider);
    // Stub formatting (a possibly-remote LLM call) so the success/late-dismiss
    // paths are deterministic; individual tests assert whether it ran.
    applyFmt = vi
      .spyOn(svc, "applyFormattingAndReplacements")
      .mockResolvedValue({
        text: "hello world",
        textBeforeReplacements: "hello world",
      });
  });

  it("early dismiss (before flush): throws USER_DISMISSED, skips the flush, writes a dismissed row", async () => {
    const session = seedSession("s1");
    session.abortController.abort();

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
    // The catch removes the session.
    expect(svc.streamingSessions.has("s1")).toBe(false);
  });

  it("a flush rejected by the dismiss-cancel becomes a silent dismissed row, not a failed one", async () => {
    const session = seedSession("s1");
    provider.flush.mockImplementation(async () => {
      // Dismiss lands mid-flush; in production reset() rejects the awaited flush.
      session.abortController.abort();
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
    expect(svc.streamingSessions.has("s1")).toBe(false);
  });

  it("post-flush dismiss (non-interruptible provider): discards the transcript instead of pasting", async () => {
    const session = seedSession("s1");
    provider.flush.mockImplementation(async () => {
      // Dismiss landed during a decode that couldn't be interrupted; the flush
      // still returns a transcript, which the post-flush gate must discard.
      session.abortController.abort();
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
  });

  it("late dismiss during formatting: the final gate discards the formatted transcript", async () => {
    const session = seedSession("s1");
    provider.flush.mockResolvedValue({ text: " world" });
    applyFmt.mockImplementation(async ({ text }: { text: string }) => {
      // Dismiss while the (possibly-remote) formatting call is in flight.
      session.abortController.abort();
      return { text, textBeforeReplacements: text };
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

    const session = seedSession("s2");
    expect(session.abortController.signal.aborted).toBe(false);
    svc.abortSession("s2");
    expect(session.abortController.signal.aborted).toBe(true);
  });
});
