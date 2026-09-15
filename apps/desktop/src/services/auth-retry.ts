import { Cause, Effect, Option } from "effect";

import { AuthenticationRequired } from "../types/errors/cloud-request";

export function retryOnceAfterAuthenticationRequired<A, E, R, E2, R2>(
  operation: () => Effect.Effect<A, E, R>,
  refresh: (error: AuthenticationRequired) => Effect.Effect<void, E2, R2>,
): Effect.Effect<A, E | E2, R | R2> {
  return Effect.suspend(operation).pipe(
    Effect.catchCause((cause) => {
      // A failed finalizer or interruption must not become a successful retry.
      if (!cause.reasons.every(Cause.isFailReason)) {
        return Effect.failCause(cause);
      }
      const failure = Cause.findErrorOption(cause);
      if (Option.isNone(failure)) return Effect.failCause(cause);
      const error = failure.value;
      return error instanceof AuthenticationRequired
        ? Effect.suspend(() => refresh(error)).pipe(
            Effect.andThen(Effect.suspend(operation)),
          )
        : Effect.failCause(cause);
    }),
  );
}
