import type {
  LifecycleEvent,
  LifecycleState,
  LifecycleTransition,
} from "../types";
import { noop, sealedFromResult, sealedState } from "./shared";

/**
 * RECORDING: capture confirmed live. Immediate seals (dismiss / quick-release
 * cancel / no-audio / capture failure) go straight to SETTLING (R6); a stop —
 * user or cap — opens RESOLVING (R5). The uniform seal law applies here too:
 * an uncommanded terminal transcription result seals on arrival.
 */
export function reduceRecording(
  state: LifecycleState & { tag: "RECORDING" },
  event: LifecycleEvent,
): LifecycleTransition {
  const session = state.session;
  switch (event.type) {
    case "stopRequested":
      return {
        state: {
          tag: "RESOLVING",
          session,
          recorderClosed: false,
          autoStopped: false,
        },
        commands: [{ type: "stopRecorder", session }],
      };
    case "expired": {
      if (event.stage !== "recording") return noop(state);
      return {
        state: {
          tag: "RESOLVING",
          session,
          recorderClosed: false,
          autoStopped: true,
        },
        commands: [{ type: "stopRecorder", session }],
      };
    }
    case "dismissRequested": {
      const sealed = { kind: "dismissed" } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [
          { type: "stopRecorder", session },
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "cancelRequested": {
      const sealed = { kind: "discard", reason: event.reason } as const;
      return {
        state: sealedState(session, sealed, false),
        commands: [
          { type: "stopRecorder", session },
          { type: "cancelTranscription", session },
          { type: "commitDisposition", session, sealed },
        ],
      };
    }
    case "noAudioDetected": {
      const sealed = { kind: "discard", reason: "no_audio" } as const;
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
    case "recorderReady":
    case "recorderClosed":
    case "storageFinished":
    case "deliveryStaged":
    case "forceReset":
      return noop(state);
  }
}
