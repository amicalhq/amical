import { describe, expect, it } from "vitest";
import { createGrammarHost } from "../../src/main/lifecycle/grammar-host";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const PRESS_MS = 3;
const QUICK_MS = 4;

function makeHarness(options?: { isDraftBlocked?: () => boolean }) {
  const calls: string[] = [];
  const timers = new FakeTimers();
  const host = createGrammarHost({
    requestStart: (mode) => calls.push(`start:${mode}`),
    requestStop: () => calls.push("stop"),
    requestCancel: (reason) => calls.push(`cancel:${reason}`),
    modeChanged: (mode) => calls.push(`mode:${mode}`),
    isDraftBlocked: options?.isDraftBlocked,
    tuning: { pressWindowMs: PRESS_MS, quickWindowMs: QUICK_MS },
    timers,
  });
  return { host, calls, timers };
}

describe("lifecycle grammar host", () => {
  it("held PTT: down starts ptt, up after the press window stops", () => {
    const h = makeHarness();
    h.host.setPttLevel(true);
    expect(h.calls).toEqual(["start:ptt"]);
    expect(h.timers.armedDurations()).toEqual([PRESS_MS]);

    h.timers.fire(PRESS_MS);
    h.host.setPttLevel(false);
    expect(h.calls).toEqual(["start:ptt", "stop"]);
    expect(h.timers.armedDurations()).toEqual([]);
  });

  it("quick tap: release inside the press window cancels on quick expiry", () => {
    const h = makeHarness();
    h.host.setPttLevel(true);
    h.host.setPttLevel(false);
    // Press window cancelled, quick window armed.
    expect(h.timers.armedDurations()).toEqual([QUICK_MS]);

    h.timers.fire(QUICK_MS);
    expect(h.calls).toEqual(["start:ptt", "cancel:quick_release"]);
    expect(h.host.getState()).toBe("idle");
  });

  it("tap-to-latch: re-press inside the quick window upgrades to hands-free", () => {
    const h = makeHarness();
    h.host.setPttLevel(true);
    h.host.setPttLevel(false);
    h.host.setPttLevel(true);
    expect(h.calls).toEqual(["start:ptt", "mode:hands-free"]);
    // The latch is fresh: its quick window re-arms so an immediate next
    // press cancels the accident instead of finalizing it.
    expect(h.timers.armedDurations()).toEqual([QUICK_MS]);
    expect(h.host.getState()).toBe("latchedFresh");

    h.timers.fire(QUICK_MS);
    expect(h.host.getState()).toBe("latched");

    // Releasing the latching press does nothing; the next press stops.
    h.host.setPttLevel(false);
    h.host.setPttLevel(true);
    expect(h.calls).toEqual(["start:ptt", "mode:hands-free", "stop"]);
  });

  it("toggle key latches hands-free; a quick second fire cancels, a later one stops", () => {
    const quick = makeHarness();
    quick.host.toggleKey();
    expect(quick.calls).toEqual(["start:hands-free"]);
    quick.host.toggleKey(); // inside the quick window: accident
    expect(quick.calls).toEqual(["start:hands-free", "cancel:quick_release"]);
    expect(quick.host.getState()).toBe("idle");

    const slow = makeHarness();
    slow.host.toggleKey();
    slow.timers.fire(QUICK_MS); // latch hardens
    slow.host.toggleKey();
    expect(slow.calls).toEqual(["start:hands-free", "stop"]);
  });

  it("PTT upgrades to hands-free on the toggle chord", () => {
    // Inside the press window: the latch stays cancellable.
    const young = makeHarness();
    young.host.setPttLevel(true);
    young.host.toggleKey();
    expect(young.calls).toEqual(["start:ptt", "mode:hands-free"]);
    expect(young.host.getState()).toBe("latchedFresh");
    // Releasing the still-held PTT chord does not stop the latched session.
    young.host.setPttLevel(false);
    expect(young.calls).toEqual(["start:ptt", "mode:hands-free"]);

    // Past the press window: an established session, no discard window.
    const old = makeHarness();
    old.host.setPttLevel(true);
    old.timers.fire(PRESS_MS);
    old.host.toggleKey();
    expect(old.calls).toEqual(["start:ptt", "mode:hands-free"]);
    expect(old.host.getState()).toBe("latched");
    old.host.setPttLevel(false);
    expect(old.host.getState()).toBe("latched");
  });

  it("draft-blocked toggle inputs are dropped; surface starts are start-only", () => {
    const blocked = makeHarness({ isDraftBlocked: () => true });
    blocked.host.toggleKey();
    blocked.host.startHandsFree();
    expect(blocked.calls).toEqual([]);
    expect(blocked.host.getState()).toBe("idle");

    const h = makeHarness();
    h.host.startHandsFree();
    expect(h.calls).toEqual(["start:hands-free"]);
    // A stray second surface click never stops or cancels: start-only.
    h.host.startHandsFree();
    h.timers.fire(QUICK_MS);
    h.host.startHandsFree();
    expect(h.calls).toEqual(["start:hands-free"]);
  });

  it("level updates are edge-detected: repeats do not re-enter the grammar", () => {
    const h = makeHarness();
    h.host.setPttLevel(true);
    h.host.setPttLevel(true);
    h.timers.fire(PRESS_MS);
    h.host.setPttLevel(false);
    h.host.setPttLevel(false);
    expect(h.calls).toEqual(["start:ptt", "stop"]);
  });

  it("lifecycleIdle resets drive state and cancels windows", () => {
    const h = makeHarness();
    h.host.setPttLevel(true);
    h.host.setPttLevel(false);
    expect(h.timers.armedDurations()).toEqual([QUICK_MS]);

    h.host.notifyLifecycleIdle();
    expect(h.host.getState()).toBe("idle");
    expect(h.timers.armedDurations()).toEqual([]);

    // The stale physical release cannot emit a phantom stop, and the next
    // press starts cleanly. (setPttLevel(false) is a no-op: already released.)
    h.host.setPttLevel(true);
    expect(h.calls).toEqual(["start:ptt", "start:ptt"]);
  });

  it("a session killed elsewhere mid-hold cannot stop a successor on release", () => {
    const h = makeHarness();
    h.host.setPttLevel(true);
    h.timers.fire(PRESS_MS);
    // Session dies (e.g. recorder failure) → lifecycle idles.
    h.host.notifyLifecycleIdle();
    // The user finally releases the chord: no phantom stop.
    h.host.setPttLevel(false);
    expect(h.calls).toEqual(["start:ptt"]);
  });
});
