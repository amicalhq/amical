import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { LiveTranscriptionSession } from "../../src/services/transcription/live-transcription-session";
import type { MaterializedTranscriptionSession } from "../../src/services/transcription/types";

/**
 * Direct characterization of LiveTranscriptionSession, written against the
 * CURRENT implementation before the Effect conversion (plan S0, D16). The v2
 * rewrite must pass this file unmodified.
 */

const deferred = <T>() => {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
};

const materialized = (
  cancel: () => void = () => {},
): MaterializedTranscriptionSession =>
  ({
    context: {
      sessionId: "s1",
      vocabulary: [],
      replacements: new Map(),
      audio: { source: "microphone" },
      accessibilityContext: null,
      cloudFormattingEnabled: false,
      isInstruct: false,
    },
    providerSession: { cancel } as unknown,
    speechModelId: "whisper-local",
    transcriptionResults: [],
  }) as unknown as MaterializedTranscriptionSession;

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("LiveTranscriptionSession — characterization", () => {
  it("dual settlement: the returned promise rejects, the drain ledger never rejects", async () => {
    const session = new LiveTranscriptionSession("s1");
    const boom = new Error("chunk failed");
    const returned = session.processChunk(() => Promise.reject(boom));
    const drain = session.drainAdmittedChunks();
    await expect(returned).rejects.toMatchObject({
      name: "Error",
      message: boom.message,
    });
    await expect(drain).resolves.toBeUndefined();
  });

  it("drain awaits a snapshot: chunks admitted after the drain call are not awaited", async () => {
    const session = new LiveTranscriptionSession("s1");
    const first = deferred<string>();
    const second = deferred<string>();
    void session.processChunk(() => first.promise);
    const drain = session.drainAdmittedChunks();
    void session.processChunk(() => second.promise);

    let drainSettled = false;
    void drain.then(() => {
      drainSettled = true;
    });
    first.resolve("a");
    await settle();
    expect(drainSettled).toBe(true);
    second.resolve("b");
  });

  it("phase is read at rejection time: a failure after abort settles as empty, not terminal", async () => {
    const listener = vi.fn();
    const session = new LiveTranscriptionSession("s1", listener);
    const gate = deferred<string>();
    const returned = session.processChunk(() => gate.promise);
    session.requestAbort();
    gate.reject(new Error("late failure"));
    await expect(returned).resolves.toBe("");
    expect(listener).not.toHaveBeenCalled();
  });

  it("a failure while live latches, fires the callback once, and rethrows the failure value", async () => {
    const listener = vi.fn();
    const session = new LiveTranscriptionSession("s1", listener);
    const boom = new Error("terminal");
    const returned = session.processChunk(() => Promise.reject(boom));
    await expect(returned).rejects.toMatchObject({
      name: "Error",
      message: boom.message,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(boom);
    // Second failure does not re-latch or re-fire.
    session.reportTerminalFailure(new Error("second"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => session.throwIfTerminalFailure()).toThrow(boom);
  });

  it("requestAbort after retire does not fire an abort event", () => {
    const session = new LiveTranscriptionSession("s1");
    const aborted = vi.fn();
    session.signal.addEventListener("abort", aborted);
    session.retire();
    session.requestAbort();
    expect(session.signal.aborted).toBe(false);
    expect(aborted).not.toHaveBeenCalled();
  });

  it("attach after abort cancels the incoming provider session and returns false", () => {
    const session = new LiveTranscriptionSession("s1");
    session.requestAbort();
    const cancel = vi.fn();
    expect(session.attach(materialized(cancel))).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retire cancels the attached provider session exactly once", () => {
    const session = new LiveTranscriptionSession("s1");
    const cancel = vi.fn();
    expect(session.attach(materialized(cancel))).toBe(true);
    session.retire();
    session.retire();
    session.requestAbort();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(session.materializedSession).toBeNull();
  });

  it("processChunk refuses work after admission closes", async () => {
    const session = new LiveTranscriptionSession("s1");
    session.closeChunkAdmission();
    const work = vi.fn(async () => "x");
    await expect(session.processChunk(work)).resolves.toBe("");
    expect(work).not.toHaveBeenCalled();
  });

  // Added at S2 (plan D6): the fork can complete — or the session can retire —
  // before the fork call returns; registration must survive both.
  it("S2 gate: work that retires the session in its synchronous prefix is still interrupted", async () => {
    const session = new LiveTranscriptionSession("s1");
    const result = session.processChunkEffect(
      Effect.sync(() => session.retire()).pipe(
        Effect.zipRight(Effect.never),
        Effect.as("unreachable"),
      ),
    );
    await expect(result).resolves.toBe("");
    await expect(session.drainAdmittedChunks()).resolves.toBeUndefined();
  });

  it("S2 gate: work that completes before registration settles normally and leaves the drain clean", async () => {
    const session = new LiveTranscriptionSession("s1");
    await expect(
      session.processChunkEffect(Effect.succeed("fast")),
    ).resolves.toBe("fast");
    await expect(session.drainAdmittedChunks()).resolves.toBeUndefined();
  });

  // Review-pass additions: the defect arm and the drain abort arms had no
  // coverage; the null-rejection case regressed and is pinned here.
  it("a synchronous throw (defect) latches and rejects with the failure value", async () => {
    const listener = vi.fn();
    const session = new LiveTranscriptionSession("s1", listener);
    const boom = new Error("sync defect");
    const returned = session.processChunkEffect(
      Effect.sync(() => {
        throw boom;
      }),
    );
    await expect(returned).rejects.toMatchObject({
      name: "Error",
      message: boom.message,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(boom);
  });

  it("a null rejection still latches terminally (presence, not value)", async () => {
    const listener = vi.fn();
    const session = new LiveTranscriptionSession("s1", listener);
    const returned = session.processChunk(() => Promise.reject(null));
    await expect(returned).rejects.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.canCompleteAdmittedWork()).toBe(false);
  });

  it("drain returns immediately when the signal is already aborted", async () => {
    const session = new LiveTranscriptionSession("s1");
    const gate = deferred<string>();
    void session.processChunk(() => gate.promise);
    session.requestAbort();
    await expect(session.drainAdmittedChunks()).resolves.toBeUndefined();
    gate.resolve("late");
  });

  it("sustained admissions drain the ledger to exactly zero", async () => {
    const session = new LiveTranscriptionSession("s1");
    const chunks: Array<Promise<string>> = [];
    for (let i = 0; i < 2000; i++) {
      chunks.push(session.processChunkEffect(Effect.succeed(String(i))));
    }
    await Promise.all(chunks);
    expect(session.openWorkCount()).toBe(0);
  });

  it("abort unblocks a pending drain without waiting for in-flight work", async () => {
    const session = new LiveTranscriptionSession("s1");
    const gate = deferred<string>();
    void session.processChunk(() => gate.promise);
    let drained = false;
    const drain = session.drainAdmittedChunks().then(() => {
      drained = true;
    });
    await settle();
    expect(drained).toBe(false);
    session.requestAbort();
    await drain;
    expect(drained).toBe(true);
    gate.resolve("late");
  });
});
