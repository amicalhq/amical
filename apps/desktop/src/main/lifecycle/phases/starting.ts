import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "../types";
import { START_TIMEOUT_CAUSE } from "../types";
import { noop, sealedState } from "./shared";

/**
 * STARTING: capture requested, not yet live. Terminal verbs seal immediately
 * as discard(interrupted_start) — nothing captured worth resolving (R3). No
 * cancelTranscription here: no stream can exist before RECORDING.
 */
export function reduceStarting(
  state: LifecycleState & { tag: "STARTING" },
  event: LifecycleEvent,
): LifecycleTransition {
  const session = state.session;
  switch (event.type) {
    case "recorderReady":
      return { state: { tag: "RECORDING", session }, commands: [] };
    case "stopRequested":
    case "dismissRequested":
    case "cancelRequested": {
      const sealed = {
        kind: "discard",
        reason: "interrupted_start",
      } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [
          { type: "stopRecorder", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "recorderFailed": {
      const sealed = { kind: "failure", cause: event.cause } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [{ type: "commitDisposition", session, sealed }],
      };
    }
    case "expired": {
      if (event.stage !== "starting") return noop(state);
      const sealed = { kind: "failure", cause: START_TIMEOUT_CAUSE } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [
          { type: "stopRecorder", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "startRequested":
    case "recorderClosed":
    case "noAudioDetected":
    case "transcriptionFinal":
    case "storageFinished":
    case "deliveryStaged":
    case "forceReset":
      return noop(state);
  }
}
