/**
 * Recording lifecycle contract — core types.
 *
 * Pure vocabulary only: no imports, no clocks, no I/O. The reducer over these
 * types is the source of the versioned lifecycle contract artifact
 * (tests/main/lifecycle-contract.json).
 */

export type SessionId = string;

export type SettlingStage = "committing" | "staging";

export type BoundStage =
  | "starting"
  | "recording"
  | "resolving"
  | "committing"
  | "staging";

export type DiscardReason = "quick_release" | "no_audio" | "interrupted_start";

/** The only reason a cancelRequested verb may carry. */
export type CancelReason = "quick_release";

export type SealedOutcome =
  | { kind: "success"; text: string }
  | { kind: "empty" }
  | { kind: "failure"; cause: string }
  | { kind: "dismissed" }
  | { kind: "discard"; reason: DiscardReason };

export type TranscriptionResult =
  | { kind: "text"; text: string }
  | { kind: "empty" }
  | { kind: "failure"; cause: string };

export type LifecycleState =
  | { tag: "IDLE" }
  | { tag: "STARTING"; session: SessionId }
  | { tag: "RECORDING"; session: SessionId }
  | {
      tag: "RESOLVING";
      session: SessionId;
      recorderClosed: boolean;
      autoStopped: boolean;
    }
  | {
      tag: "SETTLING";
      session: SessionId;
      sealed: SealedOutcome;
      stage: SettlingStage;
      autoStopped: boolean;
    };

export type LifecycleEvent =
  // verbs — shell-stamped (startRequested minted fresh, others current session)
  | { type: "startRequested"; session: SessionId }
  | { type: "stopRequested"; session: SessionId }
  | { type: "dismissRequested"; session: SessionId }
  | { type: "cancelRequested"; session: SessionId; reason: CancelReason }
  // facts — port-keyed to the session they were spawned for
  | { type: "recorderReady"; session: SessionId }
  | { type: "recorderFailed"; session: SessionId; cause: string }
  | { type: "recorderClosed"; session: SessionId }
  | { type: "noAudioDetected"; session: SessionId }
  | {
      type: "transcriptionFinal";
      session: SessionId;
      result: TranscriptionResult;
    }
  | { type: "storageFinished"; session: SessionId }
  | { type: "deliveryStaged"; session: SessionId }
  // stage bounds — armed/cancelled by stage transitions (shell rule)
  | { type: "expired"; session: SessionId; stage: BoundStage }
  // backstop injection only
  | { type: "forceReset" };

export type LifecycleCommand =
  | { type: "startRecorder"; session: SessionId }
  | { type: "stopRecorder"; session: SessionId }
  | { type: "finalizeTranscription"; session: SessionId }
  | { type: "cancelTranscription"; session: SessionId }
  | { type: "commitDisposition"; session: SessionId; sealed: SealedOutcome }
  | { type: "emitHandoff"; session: SessionId; sealed: SealedOutcome };

export interface LifecycleTransition {
  state: LifecycleState;
  commands: LifecycleCommand[];
}

/** Reducer-emitted causes; event causes are opaque pass-through payloads. */
export const START_TIMEOUT_CAUSE = "startTimeout";
export const RESOLVE_TIMEOUT_CAUSE = "timeout";

export const INITIAL_LIFECYCLE_STATE: LifecycleState = { tag: "IDLE" };
