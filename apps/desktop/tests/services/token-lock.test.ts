import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Fiber, FiberId } from "effect";
import {
  makeTokenLock,
  withLock,
  withLockPromise,
} from "../../src/services/transcription/token-lock";
import { runPromise } from "../../src/main/runtime/telemetry-runtime";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("token lock", () => {
  it("waiters acquire in arrival order (FIFO handoff)", async () => {
    const lock = makeTokenLock();
    const order: number[] = [];
    const gate = Promise.withResolvers<void>();
    const holder = withLockPromise(lock, () => gate.promise);
    await settle();
    const w1 = withLockPromise(lock, async () => {
      order.push(1);
    });
    const w2 = withLockPromise(lock, async () => {
      order.push(2);
    });
    const w3 = withLockPromise(lock, async () => {
      order.push(3);
    });
    await settle();
    expect(order).toEqual([]);
    gate.resolve();
    await Promise.all([holder, w1, w2, w3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("the rejection value crosses the promise bridge", async () => {
    const lock = makeTokenLock();
    const boom = new Error("locked work failed");
    await expect(
      withLockPromise(lock, () => Promise.reject(boom)),
    ).rejects.toMatchObject({ name: "Error", message: boom.message });
    // The token was released by the failure: the next user proceeds.
    await expect(withLockPromise(lock, async () => "next")).resolves.toBe(
      "next",
    );
  });

  it("an interrupted queued waiter neither consumes nor strands the token", async () => {
    const lock = makeTokenLock();
    const program = Effect.gen(function* () {
      const holdGate = yield* Deferred.make<void>();
      const holder = yield* Effect.fork(
        withLock(lock, Deferred.await(holdGate)),
      );
      yield* Effect.yieldNow();
      // A waiter queues behind the holder, then is interrupted while waiting.
      const waiter = yield* Effect.fork(withLock(lock, Effect.void));
      yield* Effect.yieldNow();
      const waiterExit = yield* Fiber.interrupt(waiter);
      // Release the holder; the lock must be immediately usable.
      yield* Deferred.succeed(holdGate, void 0);
      yield* Fiber.join(holder);
      const after = yield* withLock(lock, Effect.succeed("after"));
      return { waiterInterrupted: Exit.isInterrupted(waiterExit), after };
    });
    const result = await runPromise(program);
    expect(result.waiterInterrupted).toBe(true);
    expect(result.after).toBe("after");
  });

  // Review P1 regression: with a capacity-1 token queue, a waiter
  // interrupted right after release handed it the token destroyed the token
  // and deadlocked the lock forever. The waiter-queue lock must pass the
  // lock on instead. The production trigger is a terminal chunk failure
  // whose classification retires the session and interrupts a sibling that
  // was just handed the lock by the failing fiber's own release.
  it("a waiter interrupted right after the handoff passes the lock on", async () => {
    const lock = makeTokenLock();
    const program = Effect.gen(function* () {
      const holdGate = yield* Deferred.make<void>();
      const holder = yield* Effect.fork(
        withLock(lock, Deferred.await(holdGate)),
      );
      yield* Effect.yieldNow();
      const waiter = yield* Effect.fork(withLock(lock, Effect.void));
      yield* Effect.yieldNow();
      // One synchronous frame: flag the waiter interrupted, then let the
      // holder release — the handoff lands on an already-interrupting fiber.
      yield* Effect.sync(() => {
        waiter.unsafeInterruptAsFork(FiberId.none);
        Deferred.unsafeDone(holdGate, Exit.void);
      });
      yield* Fiber.await(holder);
      yield* Fiber.await(waiter);
      return yield* withLock(lock, Effect.succeed("alive"));
    });
    await expect(runPromise(program)).resolves.toBe("alive");
  }, 10000);

  it("a fiber interrupted while holding the lock releases the token", async () => {
    const lock = makeTokenLock();
    const program = Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const holder = yield* Effect.fork(
        withLock(
          lock,
          Deferred.succeed(entered, void 0).pipe(Effect.zipRight(Effect.never)),
        ),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(holder);
      return yield* withLock(lock, Effect.succeed("released"));
    });
    await expect(runPromise(program)).resolves.toBe("released");
  });
});
