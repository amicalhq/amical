import { Cause, Effect, Exit, Fiber, FiberId } from "effect";
import type { RuntimeFiber } from "effect/Fiber";
import { logger } from "../../logger";
import type { ShellTimerHost } from "../shell";
import type { SessionId } from "../types";

/**
 * SessionWork — session-scoped fiber regions for the lifecycle platform layer.
 *
 * Two regions per session (plan E1):
 * - delivery: interruptible. Killed at retirement (IDLE edge, quarantine,
 *   staging expiry). New forks are refused after retirement — abandon can
 *   precede stageDelivery, so interruption alone is not a fence.
 * - obligation: never interrupted by retirement. Drain tails, custody
 *   settlement and disposition stamps must complete after the session ends
 *   (D19/D25); the registry entry lives until the last obligation settles,
 *   and an obligation forked after the entry was reaped (the R10 quarantine
 *   → drain-bound path) resurrects a retired tombstone so settled() and the
 *   growth probe still see it.
 *
 * Timers run through the injected ShellTimerHost, never the ambient clock:
 * sleep arms `timers.set` and its canceller calls `timers.clear`, so the
 * fake-timer suites keep armed-set parity with today's adapters (E2).
 */

interface SessionRegions {
  retired: boolean;
  /** Fiber → label. "housekeeping" fibers (the wedge watchdog) are expected
   * to be interrupted at retirement and stay out of the interrupted-work
   * signal. */
  deliveries: Map<RuntimeFiber<unknown, unknown>, string>;
  obligations: Set<RuntimeFiber<unknown, unknown>>;
}

export interface SessionWorkDeps {
  timers: ShellTimerHost;
  /** Failure sink (E1 pin 9): every non-interrupt fiber failure must reach a
   * log — the platform layer's old catch-and-log semantics survive. */
  onFiberFailure?: (session: SessionId, cause: Cause.Cause<unknown>) => void;
}

export interface SessionWork {
  open(session: SessionId): void;
  /** Interrupt the delivery region and refuse future delivery forks.
   * Obligations keep running; the entry is reaped when they settle. */
  retire(session: SessionId): void;
  /** R10 alias of retire — non-suicidal: interrupts are forked, so a caller
   * running inside a delivery fiber can trigger it without deadlocking. */
  quarantine(session: SessionId): void;
  /** Fork into the delivery region. Returns false (and runs nothing) for a
   * retired or unknown session — the synchronous fence. Housekeeping fibers
   * (watchdogs) are expected to die at retirement and are excluded from the
   * interrupted-work log. */
  forkDelivery(
    session: SessionId,
    work: Effect.Effect<unknown, unknown>,
    options?: { housekeeping?: boolean },
  ): boolean;
  /** Fork work that must complete regardless of retirement. */
  runObligation(
    session: SessionId,
    work: Effect.Effect<unknown, unknown>,
  ): void;
  /** Run a child in the delivery region from inside an obligation, absorbing
   * the child's interruption: the staging task awaits its paste span, loses
   * it at retirement, and still reaches its ensuring fact (pin 10). */
  deliverySpan(
    session: SessionId,
    work: Effect.Effect<void, unknown>,
  ): Effect.Effect<void, unknown>;
  /** Timer-port-backed sleep; interruption clears the armed timer. */
  sleep(ms: number): Effect.Effect<void>;
  /** Race `work` against a timer-port bound; the loser is interrupted. */
  bounded<A>(work: Effect.Effect<A>, ms: number, fallback: A): Effect.Effect<A>;
  /** Test support: resolves when every fiber known right now has settled. */
  settled(session?: SessionId): Promise<void>;
  /** Registry probe for the growth invariant (E1 pin 8). */
  openCount(): number;
}

/** Exactly-once unconditional port facts (deliveryStaged, storageFinished on
 * the first commit attempt): fires on success, error AND interruption. */
export function ensuringFact<A, E, R>(
  work: Effect.Effect<A, E, R>,
  emit: () => void,
): Effect.Effect<A, E, R> {
  return Effect.ensuring(
    work,
    Effect.sync(() => emit()),
  );
}

export function createSessionWork(deps: SessionWorkDeps): SessionWork {
  const regions = new Map<SessionId, SessionRegions>();
  const onFiberFailure =
    deps.onFiberFailure ??
    ((session: SessionId, cause: Cause.Cause<unknown>) => {
      logger.audio.error("Session fiber failed", {
        session,
        cause: Cause.pretty(cause),
      });
    });

  function reap(session: SessionId): void {
    const r = regions.get(session);
    if (!r) return;
    if (r.retired && r.deliveries.size === 0 && r.obligations.size === 0) {
      regions.delete(session);
    }
  }

  function trackDelivery(
    session: SessionId,
    r: SessionRegions,
    fiber: RuntimeFiber<unknown, unknown>,
    label: string,
  ): void {
    // The fiber starts before runFork/forkDaemon returns. Its synchronous
    // prefix may retire and reap this region before registration completes.
    // Restore that retired tombstone so the fiber remains observable until
    // the interrupt below settles; never overwrite a different live region.
    const current = regions.get(session);
    if (current !== r) {
      r.retired = true;
      if (!current) regions.set(session, r);
    }
    r.deliveries.set(fiber, label);
    fiber.addObserver((exit) => {
      r.deliveries.delete(fiber);
      if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
        onFiberFailure(session, exit.cause);
      }
      reap(session);
    });
    if (r.retired || regions.get(session) !== r) {
      fiber.unsafeInterruptAsFork(FiberId.none);
    }
  }

  function trackObligation(
    session: SessionId,
    r: SessionRegions,
    fiber: RuntimeFiber<unknown, unknown>,
  ): void {
    r.obligations.add(fiber);
    fiber.addObserver((exit) => {
      r.obligations.delete(fiber);
      if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
        onFiberFailure(session, exit.cause);
      }
      reap(session);
    });
  }

  function retire(session: SessionId, label: string): void {
    const r = regions.get(session);
    if (!r || r.retired) return;
    r.retired = true;
    let interrupted = 0;
    for (const [fiber, fiberLabel] of r.deliveries) {
      // Forked interrupt: never suspends the caller (a delivery fiber may
      // itself be the one asking — the wedge path must not deadlock).
      fiber.unsafeInterruptAsFork(FiberId.none);
      if (fiberLabel !== "housekeeping") interrupted += 1;
    }
    if (interrupted > 0) {
      // Housekeeping fibers (the watchdog) die here on EVERY session; only
      // interrupted session work is a signal worth logging.
      logger.audio.info(`Session delivery region ${label}`, {
        session,
        interrupted,
      });
    }
    reap(session);
  }

  const sleep = (ms: number): Effect.Effect<void> =>
    Effect.async<void>((resume) => {
      const handle = deps.timers.set(ms, () => resume(Effect.void));
      return Effect.sync(() => deps.timers.clear(handle));
    });

  return {
    open(session) {
      if (regions.has(session)) return;
      regions.set(session, {
        retired: false,
        deliveries: new Map(),
        obligations: new Set(),
      });
    },

    retire(session) {
      retire(session, "retired");
    },

    quarantine(session) {
      retire(session, "quarantined");
    },

    forkDelivery(session, work, options) {
      const r = regions.get(session);
      if (!r || r.retired) return false;
      trackDelivery(
        session,
        r,
        Effect.runFork(work),
        options?.housekeeping ? "housekeeping" : "delivery",
      );
      return true;
    },

    runObligation(session, work) {
      // An unknown session gets a retired tombstone: obligations forked
      // after the reap (R10 quarantine → drain-bound close) stay visible to
      // settled() and the growth probe, while delivery forks stay refused.
      let r = regions.get(session);
      if (!r) {
        r = { retired: true, deliveries: new Map(), obligations: new Set() };
        regions.set(session, r);
      }
      trackObligation(session, r, Effect.runFork(work));
    },

    deliverySpan(session, work) {
      return Effect.suspend(() => {
        const r = regions.get(session);
        if (!r || r.retired) return Effect.void;
        return Effect.forkDaemon(work).pipe(
          Effect.flatMap((fiber) => {
            trackDelivery(session, r, fiber, "delivery");
            return Fiber.join(fiber).pipe(
              // The parent obligation absorbs the child's exit entirely and
              // proceeds to its ensuring fact: the child's own observer
              // already reported any failure to the sink (a re-propagated
              // cause would log the same defect twice).
              Effect.catchAllCause(() => Effect.void),
            );
          }),
        );
      });
    },

    sleep,

    bounded(work, ms, fallback) {
      return Effect.race(work, Effect.as(sleep(ms), fallback));
    },

    async settled(session) {
      const targets = session
        ? [regions.get(session)].filter(
            (r): r is SessionRegions => r !== undefined,
          )
        : [...regions.values()];
      const fibers = targets.flatMap((r) => [
        ...r.deliveries.keys(),
        ...r.obligations,
      ]);
      if (fibers.length === 0) return;
      await Effect.runPromise(Fiber.awaitAll(fibers));
      // One microtask so observers (set deletion, reap) run before callers
      // assert on the registry.
      await Promise.resolve();
    },

    openCount() {
      return regions.size;
    },
  };
}
