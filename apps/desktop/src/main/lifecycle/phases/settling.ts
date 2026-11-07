import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "../types";
import { noop, outcomeDelivers } from "./shared";

/**
 * SETTLING: the semantic question is closed forever; only settlement
 * progresses. The committing → staging transition makes a second EmitHandoff
 * unrepresentable (R7/R8): a tardy storageFinished in staging is a no-op.
 * The machine's course is identical whether the commit attempt succeeded or
 * failed (D15) — StorageFinished is unpayloaded and failure repair is
 * StoragePort/quarantine business.
 */
export function reduceSettling(
  state: LifecycleState & { tag: "SETTLING" },
  event: LifecycleEvent,
): LifecycleTransition {
  const session = state.session;
  const advance = (): LifecycleTransition => {
    if (outcomeDelivers(state.sealed)) {
      return {
        state: { ...state, stage: "staging" },
        commands: [{ type: "emitHandoff", session, sealed: state.sealed }],
      };
    }
    return { state: { tag: "IDLE" }, commands: [] };
  };

  switch (event.type) {
    case "storageFinished":
      if (state.stage !== "committing") return noop(state);
      return advance();
    case "expired": {
      if (event.stage === "committing" && state.stage === "committing") {
        // Commit wedged past grace: deliver anyway (record repaired via
        // quarantine) — an explicit degradation row, not an ambient window.
        return advance();
      }
      if (event.stage === "staging" && state.stage === "staging") {
        return { state: { tag: "IDLE" }, commands: [] };
      }
      return noop(state);
    }
    case "deliveryStaged":
      if (state.stage !== "staging") return noop(state);
      return { state: { tag: "IDLE" }, commands: [] };
    case "startRequested":
    case "stopRequested":
    case "dismissRequested":
    case "cancelRequested":
    case "recorderReady":
    case "recorderFailed":
    case "recorderClosed":
    case "noAudioDetected":
    case "transcriptionFinal":
    case "forceReset":
      return noop(state);
  }
}
