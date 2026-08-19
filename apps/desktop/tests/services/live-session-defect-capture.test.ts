import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect } from "effect";
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

  it("dedups a defect marked raw and later seen span-proxied", async () => {
    const onDefect = vi.fn();
    const session = new LiveTranscriptionSession("s1", undefined, onDefect);
    const observed = new TypeError("observed bug");
    // The acceptance callback marks the RAW value when it captures.
    session.markDefectsReported([observed]);
    // At resolve, the terminal gate re-dies with it under a span, so the
    // triage sees the annotation PROXY — still the same defect.
    const { Cause: EffectCause, Exit: EffectExit } = await import("effect");
    const exit = await Effect.runPromiseExit(
      Effect.die(observed).pipe(Effect.withSpan("transcription.resolve")),
    );
    const proxied = EffectExit.isFailure(exit)
      ? Array.from(EffectCause.defects(exit.cause))[0]
      : null;
    expect(proxied).not.toBe(observed);
    expect(session.wasDefectReported(proxied)).toBe(true);
  });

  it("a span-proxied chunk defect reports exactly once across both report paths", async () => {
    const onDefect = vi.fn();
    const session = new LiveTranscriptionSession("s1", undefined, onDefect);
    const bug = new TypeError("spanned chunk bug");
    const returned = session.processChunkEffect(
      Effect.die(bug).pipe(Effect.withSpan("chunk.work")),
    );
    await expect(returned).rejects.toMatchObject({ message: bug.message });
    expect(onDefect).toHaveBeenCalledTimes(1);
  });
});
