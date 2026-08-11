import { describe, expect, it } from "vitest";
import { createGrammarHost } from "../../src/main/lifecycle/grammar-host";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const PRESS_MS = 3;
const QUICK_MS = 4;

function makeHarness() {
  const calls: string[] = [];
  const timers = new FakeTimers();
  const host = createGrammarHost({
    requestStart: (mode) => calls.push(`start:${mode}`),
    requestStop: () => calls.push("stop"),
    requestCancel: (reason) => calls.push(`cancel:${reason}`),
    modeChanged: (mode) => calls.push(`mode:${mode}`),
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
    expect(h.timers.armedDurations()).toEqual([]);
    expect(h.host.getState()).toBe("latched");

    // Releasing the latching press does nothing; the next press stops.
    h.host.setPttLevel(false);
    h.host.setPttLevel(true);
    expect(h.calls).toEqual(["start:ptt", "mode:hands-free", "stop"]);
  });

  it("toggle key latches hands-free and stops on the second fire", () => {
    const h = makeHarness();
    h.host.toggleKey();
    expect(h.calls).toEqual(["start:hands-free"]);
    h.host.toggleKey();
    expect(h.calls).toEqual(["start:hands-free", "stop"]);
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
