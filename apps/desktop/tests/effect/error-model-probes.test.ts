import { describe, expect, it } from "vitest";
import { Cause, Data, Deferred, Effect, Exit, Fiber, Option } from "effect";

/**
 * Executable probes for the effect semantics the tagged-error model relies
 * on. Each probe pins a library behavior the conversion is designed around;
 * a probe failing after an effect upgrade means the design assumption broke,
 * not the app.
 */

const defectsOf = (cause: Cause.Cause<unknown>): unknown[] =>
  Array.from(Cause.defects(cause));

class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  message: string;
  cause?: unknown;
}> {}
class NetworkFailure extends Data.TaggedError("NetworkFailure")<{
  message: string;
}> {}

const isVariant = (e: unknown): e is QuotaExceeded | NetworkFailure =>
  e instanceof QuotaExceeded || e instanceof NetworkFailure;

const failOrDie = (
  e: unknown,
): Effect.Effect<never, QuotaExceeded | NetworkFailure> =>
  isVariant(e) ? Effect.fail(e) : Effect.die(e);

describe("error-model probes (effect semantics)", () => {
  it("P1: Data.TaggedError mechanics — Error subclass, tag, explicit message", () => {
    const v = new QuotaExceeded({ message: "technical detail", cause: "raw" });
    expect(v).toBeInstanceOf(Error);
    expect(v).toBeInstanceOf(QuotaExceeded);
    expect(v._tag).toBe("QuotaExceeded");
    expect(v.message).toBe("technical detail");
    expect(v.name).toBe("QuotaExceeded");
    expect(v.cause).toBe("raw");
  });

  it("P1: without an explicit message the instance has none — the message rule is mandatory", () => {
    class Bare extends Data.TaggedError("Bare")<{ detail?: string }> {}
    const v = new Bare({});
    expect(v.message ?? "").toBe("");
  });

  it("P2: the span failure proxy is read-transparent; identity is not preserved", async () => {
    const original = new QuotaExceeded({ message: "span msg" });
    const exit = await Effect.runPromiseExit(
      Effect.fail(original).pipe(Effect.withSpan("probe-span")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    const failure = Cause.failureOption(cause);
    expect(Option.isSome(failure)).toBe(true);
    const value = Option.isSome(failure) ? failure.value : null;
    expect(value).toBeInstanceOf(QuotaExceeded);
    expect((value as QuotaExceeded)._tag).toBe("QuotaExceeded");
    expect((value as QuotaExceeded).message).toBe("span msg");
  });

  it("P5: try + failOrDie turns a thrown variant into a typed failure", async () => {
    const lifted = Effect.try({
      try: () => {
        throw new QuotaExceeded({ message: "disposed" });
      },
      catch: (e) => e,
    }).pipe(Effect.catchAll(failOrDie));
    const exit = await Effect.runPromiseExit(lifted);
    const failure = Exit.isFailure(exit)
      ? Cause.failureOption(exit.cause)
      : Option.none();
    expect(Option.isSome(failure)).toBe(true);
    expect(Option.isSome(failure) ? failure.value : null).toBeInstanceOf(
      QuotaExceeded,
    );
  });

  it("P5: failOrDie sends a non-variant rejection to the defect channel", async () => {
    const lifted = Effect.tryPromise({
      try: () => Promise.reject(new TypeError("bug")),
      catch: (e) => e,
    }).pipe(Effect.catchAll(failOrDie));
    const exit = await Effect.runPromiseExit(lifted);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    expect(Option.isNone(Cause.failureOption(cause))).toBe(true);
    expect(defectsOf(cause)[0]).toBeInstanceOf(TypeError);
  });

  it("P6: a mixed Fail+Die cause keeps the failure visible on the raw exit", async () => {
    const finalizerBug = new RangeError("finalizer bug");
    const mixed = Effect.fail(new QuotaExceeded({ message: "typed" })).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          throw finalizerBug;
        }),
      ),
    );
    const exit = await Effect.runPromiseExit(mixed);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    const failure = Cause.failureOption(cause);
    expect(Option.isSome(failure)).toBe(true);
    expect(Option.isSome(failure) ? failure.value : null).toBeInstanceOf(
      QuotaExceeded,
    );
    expect(defectsOf(cause)).toContain(finalizerBug);
  });

  it("P6: catchAll skips its handler on a mixed cause; the failure value survives as the first defect", async () => {
    const finalizerBug = new RangeError("finalizer bug");
    const mixed = Effect.fail(new QuotaExceeded({ message: "typed" })).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          throw finalizerBug;
        }),
      ),
    );
    let handlerRan = false;
    const caught = mixed.pipe(
      Effect.catchAll(() => {
        handlerRan = true;
        return Effect.succeed("handled");
      }),
    );
    const exit = await Effect.runPromiseExit(caught);
    expect(handlerRan).toBe(false);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    expect(Option.isNone(Cause.failureOption(cause))).toBe(true);
    const defects = defectsOf(cause);
    expect(defects[0]).toBeInstanceOf(QuotaExceeded);
    expect(defects).toContain(finalizerBug);
    expect(isVariant(defects[0])).toBe(true);
  });

  it("P6: runPromise(Effect.either(...)) rejects on a mixed cause — Left is never produced", async () => {
    const mixed = Effect.fail(new QuotaExceeded({ message: "typed" })).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          throw new RangeError("finalizer bug");
        }),
      ),
    );
    await expect(Effect.runPromise(Effect.either(mixed))).rejects.toThrow();
  });

  it("P7: a sync throw of a tagged error inside Effect.gen is a defect, not a failure", async () => {
    const eff = Effect.gen(function* () {
      const openSession = () => {
        throw new QuotaExceeded({ message: "disposed" });
      };
      openSession();
      yield* Effect.void;
      return "unreachable";
    });
    const exit = await Effect.runPromiseExit(eff);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    expect(Option.isNone(Cause.failureOption(cause))).toBe(true);
    expect(defectsOf(cause)[0]).toBeInstanceOf(QuotaExceeded);
  });

  it("P8: an interrupted fiber with a dying finalizer keeps the defect visible in the cause", async () => {
    const finalizerBug = new SyntaxError("finalizer bug on interrupt");
    const gate = Effect.runSync(Deferred.make<void>());
    const work = Deferred.await(gate).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          throw finalizerBug;
        }),
      ),
    );
    const fiber = Effect.runFork(work);
    Effect.runSync(Fiber.interruptAsFork(fiber, fiber.id()));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    expect(Cause.isInterrupted(cause)).toBe(true);
    expect(Option.isNone(Cause.failureOption(cause))).toBe(true);
    expect(defectsOf(cause)).toContain(finalizerBug);
    expect(Option.isSome(Cause.dieOption(cause))).toBe(true);
  });

  it("P8: Effect.promise treats a rejection as a defect", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.promise(() => Promise.reject(new EvalError("dependency bug"))),
    );
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
    expect(Option.isNone(Cause.failureOption(cause))).toBe(true);
    expect(defectsOf(cause)[0]).toBeInstanceOf(EvalError);
  });

  it("P8: Cause.defects is in order and does not dedup — dedup belongs to the caller", () => {
    const a = new Error("A");
    const b = new Error("B");
    const cause = Cause.sequential(
      Cause.die(a),
      Cause.sequential(Cause.die(b), Cause.die(a)),
    );
    expect(defectsOf(cause)).toEqual([a, b, a]);
  });
});
