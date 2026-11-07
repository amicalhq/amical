import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "./types";
import { noop } from "./phases/shared";
import { reduceIdle } from "./phases/idle";
import { reduceStarting } from "./phases/starting";
import { reduceRecording } from "./phases/recording";
import { reduceResolving } from "./phases/resolving";
import { reduceSettling } from "./phases/settling";

/**
 * Recording lifecycle reducer: total over (state × event), pure, no clock,
 * no I/O; no-ops return the same state reference.
 *
 * Rule 0 (R1): when state carries a session, an event keyed to a different
 * session is a no-op — stale work from a retired session cannot re-enter.
 * forceReset (R10) is the only unkeyed event: any state → IDLE, zero
 * commands; the injector owns teardown.
 */
export function transitionLifecycle(
  state: LifecycleState,
  event: LifecycleEvent,
): LifecycleTransition {
  if (event.type === "forceReset") {
    if (state.tag === "IDLE") return noop(state);
    return { state: { tag: "IDLE" }, commands: [] };
  }

  if (state.tag === "IDLE") {
    return reduceIdle(state, event);
  }

  if (event.session !== state.session) {
    return noop(state);
  }

  switch (state.tag) {
    case "STARTING":
      return reduceStarting(state, event);
    case "RECORDING":
      return reduceRecording(state, event);
    case "RESOLVING":
      return reduceResolving(state, event);
    case "SETTLING":
      return reduceSettling(state, event);
  }
}
