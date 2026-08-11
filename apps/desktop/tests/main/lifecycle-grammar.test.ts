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

  it("tap-to-latch: quick release then re-press latches hands-free, next press stops", () => {
    const result = run(
      INITIAL_GRAMMAR_STATE,
      { type: "keyDown" },
      { type: "keyUp" },
      { type: "keyDown" },
      { type: "keyDown" },
    );
    expect(result.state).toBe("idle");
    expect(result.verbs).toEqual([
      { type: "startRequested" },
      { type: "stopRequested" },
    ]);
    expect(result.timerOps).toContainEqual({ type: "cancelQuickWindow" });
  });

  it("toggle key starts latched and stops on second toggle", () => {
    const result = run(
      INITIAL_GRAMMAR_STATE,
      { type: "toggleKey" },
      { type: "toggleKey" },
    );
    expect(result.state).toBe("idle");
    expect(result.verbs).toEqual([
      { type: "startRequested" },
      { type: "stopRequested" },
    ]);
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
