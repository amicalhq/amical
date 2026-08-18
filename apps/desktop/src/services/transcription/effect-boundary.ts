import { Cause, Effect, Exit, Option } from "effect";
import { runPromiseExit } from "../../main/runtime/telemetry-runtime";

/**
 * The ONE exit triage for promise boundaries on the transcription paths
 * (plan D8): the exact thrown object crosses the boundary — a typed failure
 * rejects with the same object, a defect rethrows the original extracted
 * from the Cause, and callers never see a FiberFailure wrapper. Interruption
 * cannot reach these boundaries (resolve is never interrupted; the chunk
 * boundary maps interrupts itself), so that arm stays loud.
 */
export const settleSameError = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  // A failure that crossed an Effect span arrives as a stack-annotating
  // Proxy (probe-verified on effect 3.22.1); Cause.originalError restores
  // the exact thrown object so reference identity survives span boundaries.
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw Cause.originalError(failure.value);
  }
  const defect = Cause.dieOption(exit.cause);
  if (Option.isSome(defect)) {
    throw Cause.originalError(defect.value);
  }
  throw new Error(
    "transcription boundary: unexpected interruption at promise boundary",
  );
};

export const runEffectSameError = <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => runPromiseExit(effect).then(settleSameError);
