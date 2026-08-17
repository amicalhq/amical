import { describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect } from "effect";
import {
  createSessionWork,
  ensuringFact,
} from "../../src/main/lifecycle/effect/session-work";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

function makeWork() {
  const timers = new FakeTimers();
  const failures: Array<{ session: string; cause: string }> = [];
  const work = createSessionWork({
    timers,
    onFiberFailure: (session, cause) =>
      failures.push({ session, cause: Cause.pretty(cause) }),
  });
  return { timers, failures, work };
}

describe("SessionWork — regions", () => {
  it("retire interrupts a sleeping delivery and clears its armed timer", async () => {
    const { timers, work } = makeWork();
    let ran = false;
    work.open("s1");
    work.forkDelivery(
      "s1",
      work.sleep(5_000).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            ran = true;
          }),
        ),
      ),
    );
    await settle();
    expect(timers.armedDurations()).toEqual([5_000]);

    work.retire("s1");
    await work.settled();
    // Armed-set parity (E2): interruption must remove the port timer.
    expect(timers.armedDurations()).toEqual([]);
    expect(ran).toBe(false);
    expect(work.openCount()).toBe(0);
  });

  it("forkDelivery is refused after retire: the effect never runs", async () => {
    const { work } = makeWork();
    const probe = vi.fn();
    work.open("s1");
    work.retire("s1");
    const accepted = work.forkDelivery("s1", Effect.sync(probe));
    await work.settled();
    expect(accepted).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    // Unknown session refuses too.
    expect(work.forkDelivery("nope", Effect.sync(probe))).toBe(false);
  });

  it("obligations survive retirement and still emit their ensuring fact", async () => {
    const { timers, work } = makeWork();
    const facts: string[] = [];
    work.open("s1");
    work.runObligation(
      "s1",
      ensuringFact(work.sleep(3_000), () => facts.push("storageFinished")),
    );
    work.retire("s1");
    await settle();
    // Retirement did NOT interrupt the obligation: its bound is still armed.
    expect(timers.armedDurations()).toEqual([3_000]);
    timers.fire(3_000);
    await work.settled();
    expect(facts).toEqual(["storageFinished"]);
    expect(work.openCount()).toBe(0);
  });

  it("deliverySpan: retirement kills the paste child; the staging obligation still emits", async () => {
    const { timers, work } = makeWork();
    const facts: string[] = [];
    let pasted = false;
    work.open("s1");
    work.runObligation(
      "s1",
      ensuringFact(
        work.deliverySpan(
          "s1",
          work.sleep(2_000).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                pasted = true;
              }),
            ),
          ),
        ),
        () => facts.push("deliveryStaged"),
      ),
    );
    await settle();
    expect(timers.armedDurations()).toEqual([2_000]);

    work.retire("s1");
    await work.settled();
    expect(pasted).toBe(false);
    // The obligation absorbed the child's interruption and emitted its fact.
    expect(facts).toEqual(["deliveryStaged"]);
  });

  it("quarantine from inside a delivery fiber does not deadlock (forked interrupt)", async () => {
    const { timers, work } = makeWork();
    const after = vi.fn();
    work.open("s1");
    work.forkDelivery(
      "s1",
      Effect.sync(() => work.quarantine("s1")).pipe(
        Effect.zipRight(work.sleep(5_000)),
        Effect.tap(() => Effect.sync(after)),
      ),
    );
    await settle();
    // Prove the fiber was interrupted rather than merely becoming invisible
    // to settled() after its region reaped during the synchronous prefix.
    expect(timers.armedDurations()).toEqual([]);
    await work.settled();
    expect(after).not.toHaveBeenCalled();
    expect(work.openCount()).toBe(0);
  });
});

describe("SessionWork — facts and sinks", () => {
  it("ensuringFact fires on error; the failure reaches the sink with the session", async () => {
    const { failures, work } = makeWork();
    const facts: string[] = [];
    work.open("s1");
    work.runObligation(
      "s1",
      ensuringFact(Effect.fail(new Error("commit failed")), () =>
        facts.push("storageFinished"),
      ),
    );
    await work.settled();
    expect(facts).toEqual(["storageFinished"]);
    expect(failures).toHaveLength(1);
    expect(failures[0].session).toBe("s1");
    expect(failures[0].cause).toContain("commit failed");
  });

  it("interrupts stay silent in the failure sink", async () => {
    const { failures, work } = makeWork();
    work.open("s1");
    work.forkDelivery("s1", work.sleep(1_000));
    await settle();
    work.retire("s1");
    await work.settled();
    expect(failures).toEqual([]);
  });
});

describe("SessionWork — bounds and growth", () => {
  it("bounded resolves the fallback at the bound and clears the loser", async () => {
    const { timers, work } = makeWork();
    const results: Array<string | null> = [];
    const gate = Effect.runSync(Deferred.make<string>());
    work.open("s1");
    work.runObligation(
      "s1",
      work
        .bounded(Deferred.await(gate), 4_000, null)
        .pipe(Effect.tap((r) => Effect.sync(() => results.push(r)))),
    );
    await settle();
    timers.fire(4_000);
    await work.settled();
    expect(results).toEqual([null]);
    expect(timers.armedDurations()).toEqual([]);
  });

  it("bounded winner interrupts the timer: armed set drains", async () => {
    const { timers, work } = makeWork();
    const gate = Effect.runSync(Deferred.make<string>());
    work.open("s1");
    work.runObligation("s1", work.bounded(Deferred.await(gate), 4_000, null));
    await settle();
    expect(timers.armedDurations()).toEqual([4_000]);
    Effect.runSync(Deferred.succeed(gate, "won"));
    await work.settled();
    expect(timers.armedDurations()).toEqual([]);
  });

  it("an obligation forked after the quarantine reap is tracked via a tombstone", async () => {
    const { timers, work } = makeWork();
    const facts: string[] = [];
    work.open("s1");
    work.quarantine("s1"); // no fibers yet: the region reaps immediately
    expect(work.openCount()).toBe(0);

    // The R10 shape: the drain-bound close tail forks its obligation AFTER
    // the reap. It must stay visible to settled() and the growth probe.
    work.runObligation(
      "s1",
      ensuringFact(work.sleep(3_000), () => facts.push("custodySettled")),
    );
    expect(work.openCount()).toBe(1);
    // The tombstone stays retired: delivery forks are still refused.
    expect(work.forkDelivery("s1", Effect.void)).toBe(false);

    timers.fire(3_000);
    await work.settled();
    expect(facts).toEqual(["custodySettled"]);
    expect(work.openCount()).toBe(0);
  });

  it("registry never grows without bound: settled sessions reap", async () => {
    const { work } = makeWork();
    for (let i = 0; i < 25; i++) {
      const id = `s${i}`;
      work.open(id);
      work.forkDelivery(id, Effect.void);
      work.runObligation(id, Effect.void);
      work.retire(id);
    }
    await work.settled();
    expect(work.openCount()).toBe(0);
  });

  it("open is idempotent and does not resurrect a retired session", async () => {
    const { work } = makeWork();
    work.open("s1");
    work.retire("s1");
    await work.settled();
    // After reap a re-open mints a fresh region (successor with same id is
    // impossible under Rule 0, but the primitive must not throw).
    work.open("s1");
    expect(work.forkDelivery("s1", Effect.void)).toBe(true);
    await work.settled();
  });
});
