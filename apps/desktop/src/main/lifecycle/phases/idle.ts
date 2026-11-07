import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "../types";
import { noop } from "./shared";

/**
 * IDLE: the only session-carrying event with a live row is startRequested,
 * which adopts the shell-minted id (R2). Everything else is stale by
 * definition (R1).
 */
export function reduceIdle(
  state: LifecycleState & { tag: "IDLE" },
  event: LifecycleEvent,
): LifecycleTransition {
  if (event.type === "startRequested") {
    return {
      state: { tag: "STARTING", session: event.session },
      commands: [{ type: "startRecorder", session: event.session }],
    };
  }
  return noop(state);
}
