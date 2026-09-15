import { describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit } from "effect";
import { LiveTranscriptionSession } from "../../src/services/transcription/live-transcription-session";
import { Cancelled } from "../../src/types/errors";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("LiveTranscriptionSession — defect capture", () => {
  it("reports a chunk defect exactly once and rejects with it", async () => {
    const onDefect = vi.fn();
    const session = new LiveTranscriptionSession("s1", undefined, onDefect);
    const bug = new TypeError("chunk bug");
    const returned = session.processChunkEffect(
      Effect.sync(() => {
        throw bug;
      }),
    );
    await expect(returned).rejects.toBe(bug);
    expect(onDefect).toHaveBeenCalledExactlyOnceWith([bug]);
    expect(session.wasDefectReported(bug)).toBe(true);
  });

  it("never reports a typed failure", async () => {
    const onDefect = vi.fn();
    const session = new LiveTranscriptionSession("s1", undefined, onDefect);
    const failure = new Cancelled({ message: "typed" });
    const returned = session.processChunkEffect(Effect.fail(failure));
    await expect(returned).rejects.toMatchObject({ _tag: "Cancelled" });
    expect(onDefect).not.toHaveBeenCalled();
  });

  it("mixed cause: the typed failure latches and settles, the co-defect is reported", async () => {
    const onDefect = vi.fn();
    const listener = vi.fn();
    const session = new LiveTranscriptionSession("s1", listener, onDefect);
    const failure = new Cancelled({ message: "typed" });
    const finalizerBug = new RangeError("finalizer bug");
    const returned = session.processChunkEffect(
      Effect.fail(failure).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            throw finalizerBug;
          }),
        ),
      ),
    );
    await expect(returned).rejects.toMatchObject({ _tag: "Cancelled" });
    expect(listener).toHaveBeenCalledExactlyOnceWith(failure);
    expect(onDefect).toHaveBeenCalledExactlyOnceWith([finalizerBug]);
  });

  it("retirement keeps a null failure and reports every co-defect once", async () => {
    const onDefect = vi.fn();
    const listener = vi.fn(() => session.retire());
    const session = new LiveTranscriptionSession("s1", listener, onDefect);
    const firstBug = new TypeError("first finalizer");
    const secondBug = new RangeError("second finalizer");
    const returned = session.processChunkEffect(
      Effect.fail(null).pipe(
        Effect.ensuring(Effect.die(firstBug)),
        Effect.ensuring(Effect.die(secondBug)),
        Effect.withSpan("chunk.work"),
      ),
    );

    await expect(returned).rejects.toBeNull();
    expect(listener).toHaveBeenCalledExactlyOnceWith(new Error("null"));
    expect(onDefect).toHaveBeenCalledExactlyOnceWith([firstBug, secondBug]);
    expect(session.openWorkCount()).toBe(0);
    expect(session.canCompleteAdmittedWork()).toBe(false);
  });

  it("abort with a dying finalizer: the defect is reported, the chunk settles empty, nothing latches", async () => {
    const onDefect = vi.fn();
    const listener = vi.fn();
    const session = new LiveTranscriptionSession("s1", listener, onDefect);
    const gate = Effect.runSync(Deferred.make<void>());
    const finalizerBug = new SyntaxError("finalizer bug on abort");
    const returned = session.processChunkEffect(
      Deferred.await(gate).pipe(
        Effect.as(""),
        Effect.ensuring(
          Effect.sync(() => {
            throw finalizerBug;
          }),
        ),
      ),
    );
    session.requestAbort();
    // Behavior preserved: the defect still crosses the promise (the feed
    // path logs it); the fix is that it is REPORTED instead of only thrown.
    await expect(returned).rejects.toBe(finalizerBug);
    await settle();
    expect(onDefect).toHaveBeenCalledExactlyOnceWith([finalizerBug]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("the latch itself does not mark — capture ownership sits with the acceptance callback", () => {
    const session = new LiveTranscriptionSession("s1");
    const observed = new TypeError("observed bug");
    session.latchTerminalFailure(observed);
    expect(session.wasDefectReported(observed)).toBe(false);
  });

  it("dedups a defect marked before it crosses a span", async () => {
    const onDefect = vi.fn();
    const session = new LiveTranscriptionSession("s1", undefined, onDefect);
    const observed = new TypeError("observed bug");
    // The acceptance callback marks the value when it captures.
    session.markDefectsReported([observed]);
    // At resolve, the terminal gate re-dies under a span. Effect 4 keeps
    // the original defect identity for the boundary's capture bookkeeping.
    const exit = await Effect.runPromiseExit(
      Effect.die(observed).pipe(Effect.withSpan("transcription.resolve")),
    );
    const spanned = Exit.isFailure(exit)
      ? exit.cause.reasons.find(Cause.isDieReason)?.defect
      : null;
    expect(spanned).toBe(observed);
    expect(session.wasDefectReported(spanned)).toBe(true);
  });

  it("a spanned chunk defect reports exactly once across both report paths", async () => {
    const onDefect = vi.fn();
    const session = new LiveTranscriptionSession("s1", undefined, onDefect);
    const bug = new TypeError("spanned chunk bug");
    const returned = session.processChunkEffect(
      Effect.die(bug).pipe(Effect.withSpan("chunk.work")),
    );
    await expect(returned).rejects.toBe(bug);
    expect(onDefect).toHaveBeenCalledExactlyOnceWith([bug]);
  });
});
