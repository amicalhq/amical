import { Effect } from "effect";
import { runPromiseExit } from "../../main/runtime/telemetry-runtime";
import { settleExit } from "../../types/errors";

/**
 * Promise boundary for the transcription paths: a typed failure rejects with
 * the failure value, a defect rethrows the defect value, and callers never
 * see a FiberFailure wrapper. The value may be the span-annotation proxy —
 * every read (_tag, fields, instanceof) resolves identically through it.
 * Interruption cannot reach these boundaries (resolve is never interrupted;
 * the chunk boundary maps interrupts itself), so that arm stays loud.
 */
export { settleExit };

export const runEffectSettled = <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => runPromiseExit(effect).then((exit) => settleExit(exit));
