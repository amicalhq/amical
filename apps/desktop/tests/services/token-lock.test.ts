import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
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

  it("drains a large queue of synchronous users in FIFO order", async () => {
    const lock = makeTokenLock();
    const gate = Deferred.makeUnsafe<void>();
    const order: number[] = [];
    const holder = Effect.runFork(withLock(lock, Deferred.await(gate)));
    const waiters = Array.from({ length: 2000 }, (_, index) =>
      Effect.runFork(
        withLock(
          lock,
          Effect.sync(() => {
            order.push(index);
          }),
        ),
      ),
    );
    try {
      expect(lock.waiters).toHaveLength(2000);
      Deferred.doneUnsafe(gate, Effect.void);
      const exits = await runPromise(
        Fiber.awaitAll([holder, ...waiters]).pipe(Effect.timeout(2000)),
      );
      expect(exits.every(Exit.isSuccess)).toBe(true);
      expect(order).toEqual(Array.from({ length: 2000 }, (_, index) => index));
      expect(lock.held).toBe(false);
      expect(lock.waiters).toHaveLength(0);
    } finally {
      // A stack overflow in a broken handoff can strand a fiber mid-resume.
      // Request cancellation without letting that failure hang test cleanup.
      for (const fiber of [holder, ...waiters]) fiber.interruptUnsafe();
    }
  });

  it("a releasing fiber cannot reacquire before an existing waiter", async () => {
    const lock = makeTokenLock();
    const order: string[] = [];
    const program = Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(
        withLock(lock, Deferred.await(gate)).pipe(
          Effect.andThen(
            withLock(
              lock,
              Effect.sync(() => order.push("reacquired")),
            ),
          ),
        ),
        { startImmediately: true },
      );
      const waiter = yield* Effect.forkChild(
        withLock(
          lock,
          Effect.sync(() => order.push("waiting")),
        ),
        { startImmediately: true },
      );
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.join(waiter);
    });

    await runPromise(program);
    expect(order).toEqual(["waiting", "reacquired"]);
  });

  it("an interrupted queued waiter neither consumes nor strands the token", async () => {
    const lock = makeTokenLock();
    const program = Effect.gen(function* () {
      const holdGate = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(
        withLock(lock, Deferred.await(holdGate)),
      );
      yield* Effect.yieldNow;
      // A waiter queues behind the holder, then is interrupted while waiting.
      const waiter = yield* Effect.forkChild(withLock(lock, Effect.void));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(waiter);
      const waiterExit = yield* Fiber.await(waiter);
      // Release the holder; the lock must be immediately usable.
      yield* Deferred.succeed(holdGate, void 0);
      yield* Fiber.join(holder);
      const after = yield* withLock(lock, Effect.succeed("after"));
      return { waiterInterrupted: Exit.hasInterrupts(waiterExit), after };
    });
    const result = await runPromise(program);
    expect(result.waiterInterrupted).toBe(true);
    expect(result.after).toBe("after");
  });

  // With a capacity-1 token queue, a waiter interrupted right after release
  // handed it the token destroyed the token
  // and deadlocked the lock forever. The waiter-queue lock must pass the
  // lock on instead. The production trigger is a terminal chunk failure
  // whose classification retires the session and interrupts a sibling that
  // was just handed the lock by the failing fiber's own release.
  it("a waiter interrupted right after the handoff passes the lock on", async () => {
    const lock = makeTokenLock();
    const order: string[] = [];
    const gate = Deferred.makeUnsafe<void>();
    const holder = Effect.runFork(withLock(lock, Deferred.await(gate)));
    const waiter = Effect.runFork(
      withLock(
        lock,
        Effect.sync(() => order.push("cancelled")),
      ),
    );
    const next = Effect.runFork(
      withLock(
        lock,
        Effect.sync(() => order.push("next")),
      ),
    );
    const fibers = [holder, waiter, next];
    try {
      Deferred.doneUnsafe(gate, Effect.void);
      // Ownership has moved to the first waiter, but its use has not started.
      expect(lock.waiters).toHaveLength(1);
      expect(lock.held).toBe(true);
      expect(order).toEqual([]);
      waiter.interruptUnsafe();
      const late = Effect.runFork(
        withLock(
          lock,
          Effect.sync(() => order.push("late")),
        ),
      );
      fibers.push(late);
      const exits = await runPromise(Fiber.awaitAll(fibers));
      expect(Exit.hasInterrupts(exits[1])).toBe(true);
      expect(order).toEqual(["next", "late"]);
      expect(lock.held).toBe(false);
      expect(lock.waiters).toHaveLength(0);
    } finally {
      await runPromise(Fiber.interruptAll(fibers));
    }
  }, 10000);

  it("a fiber interrupted while holding the lock releases the token", async () => {
    const lock = makeTokenLock();
    const program = Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(
        withLock(
          lock,
          Deferred.succeed(entered, void 0).pipe(Effect.andThen(Effect.never)),
        ),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(holder);
      return yield* withLock(lock, Effect.succeed("released"));
    });
    await expect(runPromise(program)).resolves.toBe("released");
  });
});
