import {
  INITIAL_GRAMMAR_STATE,
  transitionGrammar,
  type GrammarInput,
  type GrammarState,
} from "./grammar";
import type { RecordingMode } from "./metadata";
import { REAL_TIMER_HOST, type ShellTimerHost } from "./shell";
import type { LifecycleTuning } from "./tuning";

/**
 * Grammar host — the impure rim around the pure hotkey grammar: edge-detects
 * the (suppression-masked) PTT level into key events, arms/cancels the press
 * and quick windows, and hands emitted verbs to the lifecycle.
 *
 * Mode is derived from drive state: a held chord dictates push-to-talk; a
 * latch (toggle key, or re-press inside the quick window) is hands-free.
 */

export interface GrammarHostDeps {
  requestStart(mode: RecordingMode): void;
  requestStop(): void;
  requestCancel(reason: "quick_release"): void;
  /** A live session's mode changed (tap-to-latch upgrade). */
  modeChanged(mode: RecordingMode): void;
  tuning: Pick<LifecycleTuning, "pressWindowMs" | "quickWindowMs">;
  timers?: ShellTimerHost;
}

export interface GrammarHost {
  /** Suppression-masked PTT chord level; edges become key events. */
  setPttLevel(engaged: boolean): void;
  /** Toggle binding fired (direct-fire, no edge detection). */
  toggleKey(): void;
  /** The lifecycle returned to IDLE (any cause): reset drive state. */
  notifyLifecycleIdle(): void;
  getState(): GrammarState;
}

export function createGrammarHost(deps: GrammarHostDeps): GrammarHost {
  const timers = deps.timers ?? REAL_TIMER_HOST;

  let state: GrammarState = INITIAL_GRAMMAR_STATE;
  let pttEngaged = false;
  let pressWindow: unknown | null = null;
  let quickWindow: unknown | null = null;

  function apply(input: GrammarInput): void {
    const before = state;
    const transition = transitionGrammar(state, input);
    state = transition.state;

    for (const op of transition.timerOps) {
      switch (op.type) {
        case "armPressWindow":
          if (pressWindow !== null) timers.clear(pressWindow);
          pressWindow = timers.set(deps.tuning.pressWindowMs, () => {
            pressWindow = null;
            apply({ type: "pressWindowExpired" });
          });
          break;
        case "cancelPressWindow":
          if (pressWindow !== null) timers.clear(pressWindow);
          pressWindow = null;
          break;
        case "armQuickWindow":
          if (quickWindow !== null) timers.clear(quickWindow);
          quickWindow = timers.set(deps.tuning.quickWindowMs, () => {
            quickWindow = null;
            apply({ type: "quickWindowExpired" });
          });
          break;
        case "cancelQuickWindow":
          if (quickWindow !== null) timers.clear(quickWindow);
          quickWindow = null;
          break;
      }
    }

    for (const verb of transition.verbs) {
      switch (verb.type) {
        case "startRequested":
          deps.requestStart(state === "latched" ? "hands-free" : "ptt");
          break;
        case "stopRequested":
          deps.requestStop();
          break;
        case "cancelRequested":
          deps.requestCancel(verb.reason);
          break;
      }
    }

    // Tap-to-latch: the quick-release window re-press upgrades the live
    // session from push-to-talk to hands-free (no verb crosses the boundary).
    if (before === "window" && state === "latched") {
      deps.modeChanged("hands-free");
    }
  }

  return {
    setPttLevel(engaged: boolean): void {
      if (engaged === pttEngaged) return;
      pttEngaged = engaged;
      apply({ type: engaged ? "keyDown" : "keyUp" });
    },
    toggleKey(): void {
      apply({ type: "toggleKey" });
    },
    notifyLifecycleIdle(): void {
      apply({ type: "lifecycleIdle" });
    },
    getState(): GrammarState {
      return state;
    },
  };
}
