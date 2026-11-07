import { Cause, Exit, Option } from "effect";

/**
 * The ONE cause-aware settle for Effect→Promise/sync exits on the dictation
 * path. Settlement keeps failure priority: the first typed failure rethrows;
 * with no failure the first defect rethrows. `onDropped` receives
 * every defect that does not rethrow, so a co-present defect is reported at
 * the one point it would otherwise vanish.
 */
export const settleExit = <A>(
  exit: Exit.Exit<A, unknown>,
  onDropped?: (defects: ReadonlyArray<unknown>) => void,
): A => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.findErrorOption(exit.cause);
  const defects = exit.cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect);
  if (Option.isSome(failure)) {
    if (defects.length > 0) onDropped?.(defects);
    throw failure.value;
  }
  if (defects.length > 0) {
    if (defects.length > 1) onDropped?.(defects.slice(1));
    throw defects[0];
  }
  throw new Error("settleExit: unexpected interruption at promise boundary");
};
