/**
 * Desktop hotkey input grammar — a pure reducer that turns raw key input into
 * lifecycle verbs. NOT part of the lifecycle contract artifact: this machine
 * is local input policy (architecture §4), pure from day one so it can be
 * contracted later if a second input surface ships.
 *
 * No clock reads anywhere: "quick" is decided by event ORDER against the two
 * window expiries. Window durations are tuning; the shell arms/cancels the
 * window timers from the timerOps.
 */

export type GrammarState = "idle" | "held" | "heldLong" | "window" | "latched";

export type GrammarInput =
  | { type: "keyDown" }
  | { type: "keyUp" }
  | { type: "toggleKey" }
  | { type: "pressWindowExpired" }
  | { type: "quickWindowExpired" }
  | { type: "lifecycleIdle" };

/** Verbs for the shell to stamp and dispatch into the lifecycle. */
export type GrammarVerb =
  | { type: "startRequested" }
  | { type: "stopRequested" }
  | { type: "cancelRequested"; reason: "quick_release" };

export type GrammarTimerOp =
  | { type: "armPressWindow" }
  | { type: "cancelPressWindow" }
  | { type: "armQuickWindow" }
  | { type: "cancelQuickWindow" };

export interface GrammarTransition {
  state: GrammarState;
  verbs: GrammarVerb[];
  timerOps: GrammarTimerOp[];
}

const NONE: readonly never[] = Object.freeze([]);

function stay(state: GrammarState): GrammarTransition {
  return { state, verbs: NONE as never[], timerOps: NONE as never[] };
}

export const INITIAL_GRAMMAR_STATE: GrammarState = "idle";

export function transitionGrammar(
  state: GrammarState,
  input: GrammarInput,
): GrammarTransition {
  if (input.type === "lifecycleIdle") {
    // Session ended elsewhere: drop drive state, cancel any pending windows.
    if (state === "idle") return stay(state);
    return {
      state: "idle",
      verbs: [],
      timerOps: [{ type: "cancelPressWindow" }, { type: "cancelQuickWindow" }],
    };
  }

  switch (state) {
    case "idle":
      if (input.type === "keyDown") {
        return {
          state: "held",
          verbs: [{ type: "startRequested" }],
          timerOps: [{ type: "armPressWindow" }],
        };
      }
      if (input.type === "toggleKey") {
        return {
          state: "latched",
          verbs: [{ type: "startRequested" }],
          timerOps: [],
        };
      }
      return stay(state);
    case "held":
      if (input.type === "pressWindowExpired") {
        return { state: "heldLong", verbs: [], timerOps: [] };
      }
      if (input.type === "keyUp") {
        return {
          state: "window",
          verbs: [],
          timerOps: [{ type: "cancelPressWindow" }, { type: "armQuickWindow" }],
        };
      }
      return stay(state);
    case "heldLong":
      if (input.type === "keyUp") {
        return {
          state: "idle",
          verbs: [{ type: "stopRequested" }],
          timerOps: [],
        };
      }
      return stay(state);
    case "window":
      if (input.type === "keyDown" || input.type === "toggleKey") {
        return {
          state: "latched",
          verbs: [],
          timerOps: [{ type: "cancelQuickWindow" }],
        };
      }
      if (input.type === "quickWindowExpired") {
        return {
          state: "idle",
          verbs: [{ type: "cancelRequested", reason: "quick_release" }],
          timerOps: [],
        };
      }
      return stay(state);
    case "latched":
      if (input.type === "keyDown" || input.type === "toggleKey") {
        return {
          state: "idle",
          verbs: [{ type: "stopRequested" }],
          timerOps: [],
        };
      }
      return stay(state);
  }
}
