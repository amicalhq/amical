import { Effect } from "effect";

import { AuthenticationRequired } from "../types/errors/cloud-request";

export function retryOnceAfterAuthenticationRequired<A, E, R, E2, R2>(
  operation: () => Effect.Effect<A, E, R>,
  refresh: (error: AuthenticationRequired) => Effect.Effect<void, E2, R2>,
): Effect.Effect<A, E | E2, R | R2> {
  return Effect.suspend(operation).pipe(
    Effect.catchAll((error) =>
      error instanceof AuthenticationRequired
        ? Effect.suspend(() => refresh(error)).pipe(
            Effect.zipRight(Effect.suspend(operation)),
          )
        : Effect.fail(error),
    ),
  );
}
