import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "../types";
import { START_TIMEOUT_CAUSE } from "../types";
import { noop, sealedFromResult, sealedState } from "./shared";

/**
 * STARTING: capture requested, not yet live. Terminal verbs seal immediately
 * as discard(interrupted_start) — nothing captured worth resolving (R3).
 * Every seal here carries cancelTranscription: the transcription port may
 * open its stream at any point (D12), so a session that dies before
 * RECORDING must still retire it — cancel is idempotent on a never-opened
 * stream (D17). By the uniform seal law a terminal transcription result
 * seals here too (a stream can fast-fail before capture confirms).
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
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "recorderFailed": {
      const sealed = { kind: "failure", cause: event.cause } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "expired": {
      if (event.stage !== "starting") return noop(state);
      const sealed = { kind: "failure", cause: START_TIMEOUT_CAUSE } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [
          { type: "stopRecorder", session },
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "transcriptionFinal": {
      const sealed = sealedFromResult(event.result);
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
    case "storageFinished":
    case "deliveryStaged":
    case "forceReset":
      return noop(state);
  }
}
