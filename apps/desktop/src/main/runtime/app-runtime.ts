/**
 * Builds and tears down the app service graph (AMIC-42 step 2).
 *
 * Deliberately an explicitly OWNED CloseableScope rather than ManagedRuntime:
 * boot failure is the highest-risk surface, and owning the scope makes the
 * semantics explicit and testable — on a partial build failure NOTHING rolls
 * back. That property does NOT come for free from Layer.build: in effect
 * 3.21, Layer.build is transactional — each memoized layer builds in an inner
 * scope that is closed on failure, so acquireRelease finalizers inside layers
 * would run BEFORE the failure exit even returns, tearing down PostHog before
 * the crash path can flush telemetry (verified empirically against this exact
 * build shape). The layers therefore register their releases directly on the
 * scope created here (AppScopeTag), which Layer.build cannot see: a failed
 * boot leaves every acquired-so-far service alive exactly like the old
 * field-holding container — the crash path can still read telemetry (early
 * refs) and flush PostHog — and the subsequent will-quit cleanup() closes the
 * scope, running all registered finalizers dependents-first (reverse
 * registration order).
 */

import { Context, Effect, Exit, Layer, Scope } from "effect";

import { AppLive } from "./layers";
import { EarlyRefsTag, AppScopeTag, type AppServices } from "./tags";
import type { EarlyServiceRefs } from "../managers/service-manager";

export interface AppServicesBuild {
  scope: Scope.CloseableScope;
  exit: Exit.Exit<Context.Context<AppServices>, never>;
}

export async function buildAppServices(
  earlyRefs: EarlyServiceRefs,
): Promise<AppServicesBuild> {
  const scope = Effect.runSync(Scope.make());
  const exit = await Effect.runPromiseExit(
    Layer.build(
      AppLive.pipe(
        Layer.provide(Layer.succeed(EarlyRefsTag, earlyRefs)),
        Layer.provide(Layer.succeed(AppScopeTag, scope)),
      ),
    ).pipe(Scope.extend(scope)),
  );
  // On failure the scope is HELD un-closed: the partial graph stays alive for
  // the crash path. The caller owns closing it (cleanup()).
  return { scope, exit };
}

/** Runs every registered finalizer, dependents-first; errors are aggregated. */
export const closeAppScope = (scope: Scope.CloseableScope): Promise<void> =>
  Effect.runPromise(Scope.close(scope, Exit.void));
