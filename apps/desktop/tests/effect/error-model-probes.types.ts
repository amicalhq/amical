/**
 * Type-level probes for the tagged-error model. This file is compiled by the
 * repo tsc gate (never executed): it proves the union-inference and
 * exhaustiveness-gate assumptions at the type level, including the negative
 * case — the `@ts-expect-error` below fails the build if the exhaustiveness
 * gate ever stops firing.
 */
import { Data, Effect, Match } from "effect";

class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  message: string;
}> {}
class NetworkFailure extends Data.TaggedError("NetworkFailure")<{
  message: string;
  cause?: unknown;
}> {}
class DependencyFailure extends Data.TaggedError("DependencyFailure")<{
  message: string;
  cause: unknown;
}> {}
type ProbeError = QuotaExceeded | NetworkFailure | DependencyFailure;

const isProbeError = (e: unknown): e is ProbeError =>
  e instanceof QuotaExceeded ||
  e instanceof NetworkFailure ||
  e instanceof DependencyFailure;

// A refinement lift narrows E from unknown to the union with no cast.
const failOrDie = (e: unknown): Effect.Effect<never, ProbeError> =>
  isProbeError(e) ? Effect.fail(e) : Effect.die(e);

export const passThroughLift: Effect.Effect<string, ProbeError> =
  Effect.tryPromise({
    try: () => Promise.resolve("ok"),
    catch: (e) => e,
  }).pipe(Effect.catchAll(failOrDie));

// A wrap lift with declared unions composes through Effect.gen.
const toDependencyFailure = (e: unknown): DependencyFailure =>
  new DependencyFailure({ message: String(e), cause: e });

export const composedLifts: Effect.Effect<number, ProbeError> = Effect.gen(
  function* () {
    const s = yield* passThroughLift;
    const n = yield* Effect.tryPromise({
      try: () => Promise.resolve(s.length),
      catch: toDependencyFailure,
    });
    return n;
  },
);

// A complete exhaustive match compiles…
export const projectCode = (e: ProbeError): string =>
  Match.value(e).pipe(
    Match.tag("QuotaExceeded", () => "QUOTA_EXCEEDED"),
    Match.tag("NetworkFailure", () => "NETWORK_ERROR"),
    Match.tag("DependencyFailure", () => "UNKNOWN"),
    Match.exhaustive,
  );

// …and a missing arm fails to compile — the gate fires.
export const incompleteMatchRejected = (e: ProbeError): string =>
  Match.value(e).pipe(
    Match.tag("QuotaExceeded", () => "QUOTA_EXCEEDED"),
    Match.tag("NetworkFailure", () => "NETWORK_ERROR"),
    // @ts-expect-error — DependencyFailure has no projection arm
    Match.exhaustive,
  );
