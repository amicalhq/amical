import { Deferred, Effect, Exit, FiberId } from "effect";
import { runEffectSettled } from "./effect-boundary";

/**
 * A FIFO mutual-exclusion lock with interruption-safe handoff.
 *
 * Effect.Semaphore does not wake waiters in arrival order, and a capacity-1
 * token Queue loses the token when a waiter is interrupted after the release
 * has handed it over (probe-verified: the take completes, the fiber never
 * resumes, the token is destroyed and the lock deadlocks). This lock keeps
 * an explicit waiter queue instead: release hands the lock to the head
 * waiter under the releaser's control, and a waiter interrupted after the
 * handoff passes the lock on instead of destroying it.
 *
 * State is mutated only in synchronous regions on one JS thread, so the
 * checks below are race-free. Chunk transcript assembly depends on the FIFO
 * order; the arrival-order pin in transcription-conversion-pins.test.ts is
 * the permanent guard.
 */
export interface TokenLock {
  held: boolean;
  readonly waiters: Array<Deferred.Deferred<void>>;
}

export const makeTokenLock = (): TokenLock => ({
  held: false,
  waiters: [],
});

const release = (lock: TokenLock): void => {
  const next = lock.waiters.shift();
  if (next) {
    // Hand off directly: the lock stays held, ownership moves to the head
    // waiter. A fresh acquirer cannot barge in because held stays true.
    Deferred.unsafeDone(next, Exit.void);
  } else {
    lock.held = false;
  }
};

/**
 * Run `use` while holding the lock. The wait is interruptible; the
 * acquired→ensuring window is masked; the release runs on every exit of
 * `use` — success, failure, or interruption.
 *
 * ONE mask covers acquire and use: a nested mask would make the wait's
 * restore() restore to the outer uninterruptible state, and a queued waiter
 * could then never be interrupted (caught by token-lock.test.ts).
 */
export const withLock = <A, E, R>(
  lock: TokenLock,
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.suspend((): Effect.Effect<void> => {
      if (!lock.held) {
        lock.held = true;
        return Effect.void;
      }
      const ticket = Deferred.unsafeMake<void>(FiberId.none);
      lock.waiters.push(ticket);
      // The wait itself stays interruptible. On interruption there are two
      // cases, distinguished by queue membership: still queued means the
      // handoff never happened (drop out of line); already dequeued means
      // release handed us the lock while we were being interrupted, so pass
      // it on to the next waiter instead of destroying it.
      return restore(Deferred.await(ticket)).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            const index = lock.waiters.indexOf(ticket);
            if (index >= 0) {
              lock.waiters.splice(index, 1);
            } else {
              release(lock);
            }
          }),
        ),
      );
    }).pipe(
      Effect.zipRight(
        restore(use).pipe(Effect.ensuring(Effect.sync(() => release(lock)))),
      ),
    ),
  );

/**
 * Promise bridge for the not-yet-converted async bodies: runs `work` under
 * the lock and rethrows the failure value across the boundary.
 */
export const withLockPromise = <T>(
  lock: TokenLock,
  work: () => Promise<T>,
): Promise<T> =>
  runEffectSettled(
    withLock(lock, Effect.tryPromise({ try: work, catch: (error) => error })),
  );
