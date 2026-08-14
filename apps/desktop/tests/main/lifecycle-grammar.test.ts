import { describe, expect, it } from "vitest";
import {
  INITIAL_GRAMMAR_STATE,
  transitionGrammar,
  type GrammarInput,
  type GrammarState,
} from "../../src/main/lifecycle/grammar";

const run = (state: GrammarState, ...inputs: GrammarInput[]) => {
  const verbs: unknown[] = [];
  const timerOps: unknown[] = [];
  let current = state;
  for (const input of inputs) {
    const transition = transitionGrammar(current, input);
    verbs.push(...transition.verbs);
    timerOps.push(...transition.timerOps);
    current = transition.state;
  }
  return { state: current, verbs, timerOps };
};

describe("desktop hotkey grammar", () => {
  it("quick tap discards: down, up, quick window expiry", () => {
    const result = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "quickWindowExpired" },
    );
    expect(result.state).toBe("idle");
    expect(result.verbs).toEqual([
      { type: "startRequested" },
      { type: "cancelRequested", reason: "quick_release" },
    ]);
  });

  it("held PTT stops normally: down, press window expiry, up", () => {
    const result = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "pressWindowExpired" },
      { type: "keyUp" },
    );
    expect(result.state).toBe("idle");
    expect(result.verbs).toEqual([
      { type: "startRequested" },
      { type: "stopRequested" },
    ]);
  });

  it("tap-to-latch: quick release then re-press latches fresh; the start window keeps running", () => {
    const latched = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "keyDown" },
    );
    expect(latched.state).toBe("latchedFresh");
    // Freshness stays anchored to the start: the press window armed at
    // keyDown is never cancelled or re-armed along this path.
    expect(latched.timerOps).toEqual([
      { type: "armPressWindow" },
      { type: "armQuickWindow" },
      { type: "cancelQuickWindow" },
    ]);

    // Press inside the start-anchored window: the accident is cancelled.
    const accident = run(latched.state, { type: "keyDown" });
    expect(accident.state).toBe("idle");
    expect(accident.verbs).toEqual([
      { type: "cancelRequested", reason: "quick_release" },
    ]);

    // The start window expires: the latch hardens; the next press stops.
    const hardened = run(latched.state, { type: "pressWindowExpired" });
    expect(hardened.state).toBe("latched");
    const stopped = run(hardened.state, { type: "keyDown" });
    expect(stopped.state).toBe("idle");
    expect(stopped.verbs).toEqual([{ type: "stopRequested" }]);
  });

  it("a stale re-press window latches hard: no discard past the start window", () => {
    // Release quickly, but let the start window expire before re-pressing.
    const stale = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "pressWindowExpired" },
    );
    expect(stale.state).toBe("windowStale");

    const latched = run(stale.state, { type: "keyDown" });
    expect(latched.state).toBe("latched");
    const stopped = run(latched.state, { type: "keyDown" });
    expect(stopped.verbs).toEqual([{ type: "stopRequested" }]);

    // No re-press at all: the tap still discards on quick expiry.
    const discarded = run(stale.state, { type: "quickWindowExpired" });
    expect(discarded.state).toBe("idle");
    expect(discarded.verbs).toEqual([
      { type: "cancelRequested", reason: "quick_release" },
    ]);
  });

  it("toggle key starts latched fresh; quick second toggle cancels, later one stops", () => {
    const started = run(INITIAL_GRAMMAR_STATE, { type: "toggleKey" });
    expect(started.state).toBe("latchedFresh");
    expect(started.verbs).toEqual([{ type: "startRequested" }]);
    expect(started.timerOps).toEqual([{ type: "armPressWindow" }]);

    const quick = run(started.state, { type: "toggleKey" });
    expect(quick.verbs).toEqual([
      { type: "cancelRequested", reason: "quick_release" },
    ]);

    const late = run(
      started.state,
      { type: "pressWindowExpired" },
      { type: "toggleKey" },
    );
    expect(late.state).toBe("idle");
    expect(late.verbs).toEqual([{ type: "stopRequested" }]);
  });

  it("PTT upgrades to a latch on the toggle chord", () => {
    // Inside the start window: fresh latch, the original window keeps
    // running (freshness never restarts — the reviewer's t=0/400/600 case).
    const young = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "toggleKey" },
    );
    expect(young.state).toBe("latchedFresh");
    expect(young.timerOps).toEqual([{ type: "armPressWindow" }]);

    // The start window expires (t=500): a press now is a normal stop, not
    // a discard — the upgrade did not extend discard eligibility.
    const aged = run(young.state, { type: "pressWindowExpired" });
    expect(aged.state).toBe("latched");
    expect(run(aged.state, { type: "keyDown" }).verbs).toEqual([
      { type: "stopRequested" },
    ]);

    // Past the press window: hard latch, and the chord release is inert.
    const old = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "pressWindowExpired" },
      { type: "toggleKey" },
    );
    expect(old.state).toBe("latched");
    const released = run(old.state, { type: "keyUp" });
    expect(released.state).toBe("latched");
    expect(released.verbs).toEqual([]);
  });

  it("quickness is decided by event order, not clocks", () => {
    // Same physical gesture, opposite orderings against the press window.
    const quick = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
    );
    expect(quick.state).toBe("window");

    const slow = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "pressWindowExpired" },
      { type: "keyUp" },
    );
    expect(slow.verbs).toContainEqual({ type: "stopRequested" });
  });

  it("lifecycleIdle resets drive state and cancels windows from anywhere", () => {
    const result = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "lifecycleIdle" },
      { type: "quickWindowExpired" },
    );
    expect(result.state).toBe("idle");
    expect(result.verbs).toEqual([{ type: "startRequested" }]);
    expect(result.timerOps).toContainEqual({ type: "cancelQuickWindow" });
  });

  it("stale window expiries are no-ops", () => {
    const afterLatch = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "keyDown" },
      { type: "quickWindowExpired" },
    );
    expect(afterLatch.state).toBe("latchedFresh");
    expect(afterLatch.verbs).toEqual([{ type: "startRequested" }]);
  });

  it("key repeat while held is a no-op", () => {
    const result = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "pressWindowExpired" },
      { type: "keyDown" },
    );
    expect(result.state).toBe("heldLong");
    expect(result.verbs).toEqual([{ type: "startRequested" }]);
  });
});
