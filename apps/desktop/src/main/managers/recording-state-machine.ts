export type RecordingMode = "idle" | "ptt" | "hands-free";

export type ActiveRecordingMode = Exclude<RecordingMode, "idle">;

export type TerminationCode =
  | "quick_release"
  | "no_audio"
  | "interrupted_start"
  | "user_dismissed";

export type RecordingMachineState =
  | { tag: "IDLE" }
  // Brief public handshake after accepting a start. Renderer audio capture is
  // still triggered by REC_* / public "recording", matching the pre-FSM flow.
  | {
      tag: "STARTING";
      mode: ActiveRecordingMode;
    }
  | {
      tag: "REC_PTT";
      firstChunkReceived: boolean;
    }
  | {
      tag: "PTT_Q";
      firstChunkReceived: boolean;
    }
  | {
      tag: "REC_HF";
      firstChunkReceived: boolean;
    }
  | { tag: "STOP_N" }
  | { tag: "STOP_C"; code: TerminationCode };

export type RecordingMachineEvent =
  | {
      type: "start";
      mode: ActiveRecordingMode;
      hasSpeechModel: boolean;
    }
  | { type: "startSessionReady" }
  | { type: "pttPress"; quick: boolean }
  | { type: "pttRelease"; quick: boolean }
  | { type: "toggle"; quick: boolean }
  | { type: "signalStop" }
  | { type: "dismiss" }
  | { type: "quickReleaseTimeout" }
  | { type: "noAudioTimeout" }
  | { type: "durationWarningTimeout" }
  | { type: "maxDurationTimeout" }
  | { type: "audioChunk"; hasAudio: boolean }
  | { type: "reset" }
  | { type: "forceReset" };

export type RecordingMachineCommand =
  | { type: "notifyMissingModel" }
  | { type: "logUnexpectedStart"; mode: ActiveRecordingMode }
  | { type: "startSession"; mode: ActiveRecordingMode }
  | { type: "startQuickReleaseTimer" }
  | { type: "clearQuickReleaseTimer" }
  | { type: "stopSession"; code: TerminationCode | null }
  | { type: "abortFinalization" }
  | { type: "markFirstAudioReceived" }
  | { type: "notifyNoAudio" }
  | { type: "notifyDurationWarning" }
  | { type: "notifyRecordingAutoStopped" };

export interface RecordingMachineTransition {
  state: RecordingMachineState;
  commands: RecordingMachineCommand[];
}

export const initialRecordingMachineState = (): RecordingMachineState => ({
  tag: "IDLE",
});

const isRecordingState = (
  state: RecordingMachineState,
): state is Extract<
  RecordingMachineState,
  { tag: "REC_PTT" | "PTT_Q" | "REC_HF" }
> => state.tag === "REC_PTT" || state.tag === "PTT_Q" || state.tag === "REC_HF";

const withFirstChunkReceived = (
  state: RecordingMachineState,
): RecordingMachineState => {
  if (!isRecordingState(state) || state.firstChunkReceived) {
    return state;
  }

  return { ...state, firstChunkReceived: true };
};

const clearPttQTimerIfNeeded = (
  state: RecordingMachineState,
): readonly RecordingMachineCommand[] =>
  state.tag === "PTT_Q"
    ? ([{ type: "clearQuickReleaseTimer" }] as const)
    : ([] as const);

export function transitionRecordingMachine(
  state: RecordingMachineState,
  event: RecordingMachineEvent,
): RecordingMachineTransition {
  switch (event.type) {
    case "reset":
      if (
        state.tag !== "IDLE" &&
        state.tag !== "STOP_N" &&
        state.tag !== "STOP_C"
      ) {
        return { state, commands: [] };
      }

      return { state: initialRecordingMachineState(), commands: [] };

    case "forceReset":
      return { state: initialRecordingMachineState(), commands: [] };

    case "start":
      if (state.tag !== "IDLE") {
        return {
          state,
          commands: [{ type: "logUnexpectedStart", mode: event.mode }],
        };
      }

      if (!event.hasSpeechModel) {
        return { state, commands: [{ type: "notifyMissingModel" }] };
      }

      // STARTING is only reachable after a speech model is known to exist.
      return {
        state: {
          tag: "STARTING",
          mode: event.mode,
        },
        commands: [{ type: "startSession", mode: event.mode }],
      };

    case "startSessionReady":
      if (state.tag !== "STARTING") {
        return { state, commands: [] };
      }

      return {
        state:
          state.mode === "ptt"
            ? {
                tag: "REC_PTT",
                firstChunkReceived: false,
              }
            : {
                tag: "REC_HF",
                firstChunkReceived: false,
              },
        commands: [],
      };

    case "pttPress":
      if (state.tag === "PTT_Q") {
        return {
          state: {
            tag: "REC_HF",
            firstChunkReceived: state.firstChunkReceived,
          },
          commands: [{ type: "clearQuickReleaseTimer" }],
        };
      }

      if (state.tag === "REC_HF") {
        return event.quick
          ? {
              state: { tag: "STOP_C", code: "quick_release" },
              commands: [{ type: "stopSession", code: "quick_release" }],
            }
          : {
              state: { tag: "STOP_N" },
              commands: [{ type: "stopSession", code: null }],
            };
      }

      // Key-repeat or duplicate key-down while already in PTT recording is ignored.
      return { state, commands: [] };

    case "pttRelease":
      if (state.tag !== "REC_PTT") {
        return { state, commands: [] };
      }

      return event.quick
        ? {
            state: {
              tag: "PTT_Q",
              firstChunkReceived: state.firstChunkReceived,
            },
            commands: [{ type: "startQuickReleaseTimer" }],
          }
        : {
            state: { tag: "STOP_N" },
            commands: [{ type: "stopSession", code: null }],
          };

    case "toggle":
      if (state.tag === "PTT_Q") {
        return {
          state: {
            tag: "REC_HF",
            firstChunkReceived: state.firstChunkReceived,
          },
          commands: [{ type: "clearQuickReleaseTimer" }],
        };
      }

      if (state.tag === "REC_PTT") {
        return {
          state: {
            tag: "REC_HF",
            firstChunkReceived: state.firstChunkReceived,
          },
          commands: [],
        };
      }

      if (state.tag === "REC_HF") {
        return event.quick
          ? {
              state: { tag: "STOP_C", code: "quick_release" },
              commands: [{ type: "stopSession", code: "quick_release" }],
            }
          : {
              state: { tag: "STOP_N" },
              commands: [{ type: "stopSession", code: null }],
            };
      }

      return { state, commands: [] };

    case "signalStop":
      if (state.tag === "STARTING") {
        return {
          state: { tag: "STOP_C", code: "interrupted_start" },
          commands: [{ type: "stopSession", code: "interrupted_start" }],
        };
      }

      if (!isRecordingState(state)) {
        return { state, commands: [] };
      }

      return {
        state: { tag: "STOP_N" },
        commands: [
          ...clearPttQTimerIfNeeded(state),
          { type: "stopSession", code: null },
        ],
      };

    case "dismiss":
      // Dismiss before audio capture begins is an interrupted start — there is
      // no audio yet (capture starts in the "recording" state), so reuse the
      // existing discard path rather than persisting an empty row.
      if (state.tag === "STARTING") {
        return {
          state: { tag: "STOP_C", code: "interrupted_start" },
          commands: [{ type: "stopSession", code: "interrupted_start" }],
        };
      }

      // Dismiss during an in-flight finalize (STOP_N). The session is already
      // stopping and finalizeSession is running, so we must NOT re-stop it —
      // instead abort the transcription so it persists a dismissed row rather
      // than pasting. A STOP_C (cancel already in flight) falls through to the
      // no-op below.
      if (state.tag === "STOP_N") {
        return {
          state: { tag: "STOP_C", code: "user_dismissed" },
          commands: [{ type: "abortFinalization" }],
        };
      }

      if (!isRecordingState(state)) {
        return { state, commands: [] };
      }

      return {
        state: { tag: "STOP_C", code: "user_dismissed" },
        commands: [
          ...clearPttQTimerIfNeeded(state),
          { type: "stopSession", code: "user_dismissed" },
        ],
      };

    case "quickReleaseTimeout":
      if (state.tag !== "PTT_Q") {
        return { state, commands: [] };
      }

      return {
        state: { tag: "STOP_C", code: "quick_release" },
        commands: [{ type: "stopSession", code: "quick_release" }],
      };

    case "noAudioTimeout":
      if (!isRecordingState(state) || state.firstChunkReceived) {
        return { state, commands: [] };
      }

      return {
        state: { tag: "STOP_C", code: "no_audio" },
        commands: [
          { type: "notifyNoAudio" },
          ...clearPttQTimerIfNeeded(state),
          { type: "stopSession", code: "no_audio" },
        ],
      };

    case "durationWarningTimeout":
      if (!isRecordingState(state)) {
        return { state, commands: [] };
      }

      return {
        state,
        commands: [{ type: "notifyDurationWarning" }],
      };

    case "maxDurationTimeout":
      if (!isRecordingState(state)) {
        return { state, commands: [] };
      }

      return {
        state: { tag: "STOP_N" },
        commands: [
          { type: "notifyRecordingAutoStopped" },
          ...clearPttQTimerIfNeeded(state),
          { type: "stopSession", code: null },
        ],
      };

    case "audioChunk":
      if (!event.hasAudio || !isRecordingState(state)) {
        return { state, commands: [] };
      }

      if (state.firstChunkReceived) {
        return { state, commands: [] };
      }

      return {
        state: withFirstChunkReceived(state),
        commands: [{ type: "markFirstAudioReceived" }],
      };
  }
}
