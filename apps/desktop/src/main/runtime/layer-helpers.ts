/**
 * Shared building blocks for service layers (AMIC-42). Used by the central
 * layers.ts wrappers and by services that own their Live layer directly.
 */

import { Effect, Scope } from "effect";

import { logger } from "../logger";

export const up = (name: string) => logger.main.debug(`[layers] ${name} up`);

export const down = (name: string) =>
  Effect.sync(() => logger.main.debug(`[layers] ${name} down`));

/**
 * Registers a service release on the app scope. Releases must NOT use
 * Effect.acquireRelease inside a layer: Layer.build is transactional in
 * effect 3.21 and closes layer scopes on partial build failure, which would
 * tear down already-acquired services before the crash path can use them
 * (see app-runtime.ts). Finalizers on the app scope are invisible to
 * Layer.build, so a failed boot leaves the partial graph alive until
 * cleanup() closes the scope.
 *
 * `legacyMessage` is the old ServiceManager cleanup()'s info line for this
 * service, logged BEFORE the release exactly as the old container did — a
 * shutdown hang stays attributable from the last info line in field logs.
 */
export const addRelease = (
  appScope: Scope.CloseableScope,
  legacyMessage: string,
  name: string,
  release: () => void | Promise<void>,
) =>
  Scope.addFinalizer(
    appScope,
    Effect.sync(() => logger.main.info(legacyMessage)).pipe(
      Effect.zipRight(
        Effect.promise(async () => {
          await release();
        }),
      ),
      Effect.zipLeft(down(name)),
    ),
  );

/**
 * Awaited init step, interruption-masked: when a concurrent sibling layer
 * fails, Effect interrupts this fiber — without the mask it would abandon
 * the in-flight promise detached, which the old sequential boot never could.
 */
export const step = <T>(run: () => Promise<T>) =>
  Effect.uninterruptible(Effect.promise(run));
