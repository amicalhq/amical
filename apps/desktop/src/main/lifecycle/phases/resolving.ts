import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "../types";
import { RESOLVE_TIMEOUT_CAUSE } from "../types";
import { noop, sealedFromResult, sealedState } from "./shared";

/**
 * RESOLVING: the outcome is open. RecorderClosed gates finalize; a mid-drain
 * recorder death finalizes what was fed (R5). The uniform seal law: a
 * terminal transcription result seals regardless of recorderClosed — nothing
 * parks and no deadline can destroy a result. Dismiss wins pre-seal by queue
 * order (R9).
 */
export function reduceResolving(
  state: LifecycleState & { tag: "RESOLVING" },
  event: LifecycleEvent,
): LifecycleTransition {
  const session = state.session;
  switch (event.type) {
    case "recorderClosed":
    case "recorderFailed": {
      if (state.recorderClosed) return noop(state);
      return {
        state: { ...state, recorderClosed: true },
        commands: [{ type: "finalizeTranscription", session }],
      };
    }
    case "transcriptionFinal": {
      const sealed = sealedFromResult(event.result);
      return {
        state: sealedState(session, sealed, state.autoStopped),
        commands: [{ type: "commitDisposition", session, sealed }],
      };
    }
    case "dismissRequested": {
      const sealed = { kind: "dismissed" } as const;
      return {
        state: sealedState(session, sealed, state.autoStopped),
        commands: [
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "expired": {
      if (event.stage !== "resolving") return noop(state);
      const sealed = { kind: "failure", cause: RESOLVE_TIMEOUT_CAUSE } as const;
      return {
        state: sealedState(session, sealed, state.autoStopped),
        commands: [
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "startRequested":
    case "stopRequested":
    case "cancelRequested":
    case "recorderReady":
    case "noAudioDetected":
    case "storageFinished":
    case "deliveryStaged":
    case "forceReset":
      return noop(state);
  }
}
