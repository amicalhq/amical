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

  it("tap-to-latch: quick release then re-press latches fresh; press after the window stops", () => {
    const latched = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "keyDown" },
    );
    expect(latched.state).toBe("latchedFresh");
    expect(latched.timerOps).toContainEqual({ type: "armQuickWindow" });

    // Press inside the fresh window: the accident is cancelled.
    const accident = run(latched.state, { type: "keyDown" });
    expect(accident.state).toBe("idle");
    expect(accident.verbs).toEqual([
      { type: "cancelRequested", reason: "quick_release" },
    ]);

    // Window expires: the latch hardens; the next press is a normal stop.
    const hardened = run(latched.state, { type: "quickWindowExpired" });
    expect(hardened.state).toBe("latched");
    const stopped = run(hardened.state, { type: "keyDown" });
    expect(stopped.state).toBe("idle");
    expect(stopped.verbs).toEqual([{ type: "stopRequested" }]);
  });

  it("toggle key starts latched fresh; quick second toggle cancels, later one stops", () => {
    const started = run(INITIAL_GRAMMAR_STATE, { type: "toggleKey" });
    expect(started.state).toBe("latchedFresh");
    expect(started.verbs).toEqual([{ type: "startRequested" }]);
    expect(started.timerOps).toContainEqual({ type: "armQuickWindow" });

    const quick = run(started.state, { type: "toggleKey" });
    expect(quick.verbs).toEqual([
      { type: "cancelRequested", reason: "quick_release" },
    ]);

    const late = run(
      started.state,
      { type: "quickWindowExpired" },
      { type: "toggleKey" },
    );
    expect(late.state).toBe("idle");
    expect(late.verbs).toEqual([{ type: "stopRequested" }]);
  });

  it("PTT upgrades to a latch on the toggle chord", () => {
    // Inside the press window: fresh latch, quick window armed.
    const young = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "toggleKey" },
    );
    expect(young.state).toBe("latchedFresh");
    expect(young.timerOps).toContainEqual({ type: "cancelPressWindow" });
    expect(young.timerOps).toContainEqual({ type: "armQuickWindow" });

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
    expect(afterLatch.state).toBe("latched");
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
