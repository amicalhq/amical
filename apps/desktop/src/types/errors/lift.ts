import { Effect } from "effect";
import { DependencyFailure } from "./service";
import { isDictationError, type DictationError } from "./union";

/**
 * Wrap policy: an expected foreign rejection becomes a typed
 * DependencyFailure; an already-typed value passes through.
 */
export const toDependencyFailure = (cause: unknown): DictationError =>
  isDictationError(cause)
    ? cause
    : new DependencyFailure({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

/**
 * Pass-through/die policy: after an identity lift (whose catch channel is
 * unknown), refine by VALUE — a domain variant fails typed, anything else is
 * a programming defect and dies. Never cast around this; a cast silently
 * defeats the die policy.
 */
export const failOrDie = (
  error: unknown,
): Effect.Effect<never, DictationError> =>
  isDictationError(error) ? Effect.fail(error) : Effect.die(error);
