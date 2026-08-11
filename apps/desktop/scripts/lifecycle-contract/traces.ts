import type {
  LifecycleCommand,
  LifecycleEvent,
  LifecycleState,
  SealedOutcome,
} from "../../src/main/lifecycle/types";
import type { LifecycleProjection } from "../../src/main/lifecycle/projection";
import {
  CURRENT_SESSION as S,
  FRESH_SESSION as N,
  STALE_SESSION as X,
  REPRESENTATIVE_CAUSE as CAUSE,
  REPRESENTATIVE_TEXT as TEXT,
} from "./atoms";

/**
 * Trace fixtures: multi-event scenarios with HAND-WRITTEN expectations. The
 * generator refuses to emit an artifact whose reducer disagrees with any
 * step, so these are double-entry bookkeeping against the reducer the
 * vectors are generated from. Zero timestamps anywhere: time exists only as
 * expiry events.
 */

export interface LifecycleTraceStep {
  event: LifecycleEvent;
  expect: {
    state: LifecycleState;
    commands: LifecycleCommand[];
    projection: LifecycleProjection;
  };
}

export interface LifecycleTrace {
  name: string;
  given: LifecycleState;
  steps: LifecycleTraceStep[];
}

// ---------- constructors (fixture readability only) ----------

const idle: LifecycleState = { tag: "IDLE" };
const starting: LifecycleState = { tag: "STARTING", session: S };
const recording: LifecycleState = { tag: "RECORDING", session: S };
const resolving = (
  recorderClosed: boolean,
  autoStopped = false,
): LifecycleState => ({
  tag: "RESOLVING",
  session: S,
  recorderClosed,
  autoStopped,
});
const settling = (
  sealed: SealedOutcome,
  stage: "committing" | "staging",
  autoStopped = false,
): LifecycleState => ({
  tag: "SETTLING",
  session: S,
  sealed,
  stage,
  autoStopped,
});

const success: SealedOutcome = { kind: "success", text: TEXT };
const dismissed: SealedOutcome = { kind: "dismissed" };
const failureCause: SealedOutcome = { kind: "failure", cause: CAUSE };
const failureTimeout: SealedOutcome = { kind: "failure", cause: "timeout" };
const failureStartTimeout: SealedOutcome = {
  kind: "failure",
  cause: "startTimeout",
};
const discard = (
  reason: "quick_release" | "no_audio" | "interrupted_start",
): SealedOutcome => ({ kind: "discard", reason });

const finalText: LifecycleEvent = {
  type: "transcriptionFinal",
  session: S,
  result: { kind: "text", text: TEXT },
};

const proj = (
  publicState: LifecycleProjection["publicState"],
  stopKind: LifecycleProjection["stopKind"] = "none",
  stopOrigin: LifecycleProjection["stopOrigin"] = "none",
  terminal: SealedOutcome | null = null,
): LifecycleProjection => ({ publicState, stopKind, stopOrigin, terminal });

const commit = (sealed: SealedOutcome): LifecycleCommand => ({
  type: "commitDisposition",
  session: S,
  sealed,
});
const handoff = (sealed: SealedOutcome): LifecycleCommand => ({
  type: "emitHandoff",
  session: S,
  sealed,
});
const stopRecorder: LifecycleCommand = { type: "stopRecorder", session: S };
const cancelStt: LifecycleCommand = { type: "cancelTranscription", session: S };
const finalizeStt: LifecycleCommand = {
  type: "finalizeTranscription",
  session: S,
};

const noopStep = (
  event: LifecycleEvent,
  state: LifecycleState,
  projection: LifecycleProjection,
): LifecycleTraceStep => ({
  event,
  expect: { state, commands: [], projection },
});

// ---------- the fixtures ----------

export const LIFECYCLE_TRACES: LifecycleTrace[] = [
  {
    name: "happy-path: start, record, stop, drain, finalize, commit, handoff, staged, idle",
    given: idle,
    steps: [
      {
        event: { type: "startRequested", session: S },
        expect: {
          state: starting,
          commands: [{ type: "startRecorder", session: S }],
          projection: proj("starting"),
        },
      },
      {
        event: { type: "recorderReady", session: S },
        expect: {
          state: recording,
          commands: [],
          projection: proj("recording"),
        },
      },
      {
        event: { type: "stopRequested", session: S },
        expect: {
          state: resolving(false),
          commands: [stopRecorder],
          projection: proj("stopping", "finalize", "user"),
        },
      },
      {
        event: { type: "recorderClosed", session: S },
        expect: {
          state: resolving(true),
          commands: [finalizeStt],
          projection: proj("stopping", "finalize", "user"),
        },
      },
      {
        event: finalText,
        expect: {
          state: settling(success, "committing"),
          commands: [commit(success)],
          projection: proj("stopping", "finalize", "user", success),
        },
      },
      {
        event: { type: "storageFinished", session: S },
        expect: {
          state: settling(success, "staging"),
          commands: [handoff(success)],
          projection: proj("stopping", "finalize", "user", success),
        },
      },
      {
        event: { type: "deliveryStaged", session: S },
        expect: { state: idle, commands: [], projection: proj("idle") },
      },
    ],
  },
  {
    name: "admission: startRequested while busy is a no-op",
    given: recording,
    steps: [
      noopStep(
        { type: "startRequested", session: N },
        recording,
        proj("recording"),
      ),
    ],
  },
  {
    name: "uniform seal law: early final before recorderClosed seals; late close no-ops",
    given: resolving(false),
    steps: [
      {
        event: finalText,
        expect: {
          state: settling(success, "committing"),
          commands: [commit(success)],
          projection: proj("stopping", "finalize", "user", success),
        },
      },
      noopStep(
        { type: "recorderClosed", session: S },
        settling(success, "committing"),
        proj("stopping", "finalize", "user", success),
      ),
    ],
  },
  {
    name: "uniform seal law: uncommanded terminal failure mid-recording seals",
    given: recording,
    steps: [
      {
        event: {
          type: "transcriptionFinal",
          session: S,
          result: { kind: "failure", cause: CAUSE },
        },
        expect: {
          state: settling(failureCause, "committing"),
          commands: [stopRecorder, commit(failureCause)],
          projection: proj("stopping", "finalize", "user", failureCause),
        },
      },
    ],
  },
  {
    name: "dismiss wins pre-seal; late final no-ops",
    given: resolving(true),
    steps: [
      {
        event: { type: "dismissRequested", session: S },
        expect: {
          state: settling(dismissed, "committing"),
          commands: [cancelStt, commit(dismissed)],
          projection: proj("stopping", "dismiss", "user", dismissed),
        },
      },
      noopStep(
        finalText,
        settling(dismissed, "committing"),
        proj("stopping", "dismiss", "user", dismissed),
      ),
    ],
  },
  {
    name: "seal wins first; late dismiss no-ops",
    given: resolving(true),
    steps: [
      {
        event: finalText,
        expect: {
          state: settling(success, "committing"),
          commands: [commit(success)],
          projection: proj("stopping", "finalize", "user", success),
        },
      },
      noopStep(
        { type: "dismissRequested", session: S },
        settling(success, "committing"),
        proj("stopping", "finalize", "user", success),
      ),
    ],
  },
  {
    name: "resolve deadline seals failure(timeout)",
    given: resolving(true),
    steps: [
      {
        event: { type: "expired", session: S, stage: "resolving" },
        expect: {
          state: settling(failureTimeout, "committing"),
          commands: [cancelStt, commit(failureTimeout)],
          projection: proj("stopping", "finalize", "user", failureTimeout),
        },
      },
    ],
  },
  {
    name: "mid-drain recorder death finalizes what was fed",
    given: resolving(false),
    steps: [
      {
        event: { type: "recorderFailed", session: S, cause: CAUSE },
        expect: {
          state: resolving(true),
          commands: [finalizeStt],
          projection: proj("stopping", "finalize", "user"),
        },
      },
      {
        event: finalText,
        expect: {
          state: settling(success, "committing"),
          commands: [commit(success)],
          projection: proj("stopping", "finalize", "user", success),
        },
      },
    ],
  },
  {
    name: "exactly one handoff: commit-grace degradation, tardy storageFinished no-ops",
    given: settling(success, "committing"),
    steps: [
      {
        event: { type: "expired", session: S, stage: "committing" },
        expect: {
          state: settling(success, "staging"),
          commands: [handoff(success)],
          projection: proj("stopping", "finalize", "user", success),
        },
      },
      noopStep(
        { type: "storageFinished", session: S },
        settling(success, "staging"),
        proj("stopping", "finalize", "user", success),
      ),
      {
        event: { type: "deliveryStaged", session: S },
        expect: { state: idle, commands: [], projection: proj("idle") },
      },
    ],
  },
  {
    name: "staging bound returns to idle; staging work is fenced",
    given: settling(success, "staging"),
    steps: [
      {
        event: { type: "expired", session: S, stage: "staging" },
        expect: { state: idle, commands: [], projection: proj("idle") },
      },
    ],
  },
  {
    name: "non-delivering outcome skips staging",
    given: settling(dismissed, "committing"),
    steps: [
      {
        event: { type: "storageFinished", session: S },
        expect: { state: idle, commands: [], projection: proj("idle") },
      },
    ],
  },
  {
    name: "rule 0: stale-session events are fenced at every consequence point",
    given: recording,
    steps: [
      noopStep(
        { type: "stopRequested", session: X },
        recording,
        proj("recording"),
      ),
      noopStep(
        { type: "noAudioDetected", session: X },
        recording,
        proj("recording"),
      ),
      noopStep(
        {
          type: "transcriptionFinal",
          session: X,
          result: { kind: "text", text: TEXT },
        },
        recording,
        proj("recording"),
      ),
      noopStep(
        { type: "expired", session: X, stage: "recording" },
        recording,
        proj("recording"),
      ),
    ],
  },
  {
    name: "forceReset mid-resolving: idle, zero commands",
    given: resolving(true),
    steps: [
      {
        event: { type: "forceReset" },
        expect: { state: idle, commands: [], projection: proj("idle") },
      },
    ],
  },
  {
    name: "dead mic seals discard(no_audio); duplicate detection no-ops",
    given: recording,
    steps: [
      {
        event: { type: "noAudioDetected", session: S },
        expect: {
          state: settling(discard("no_audio"), "committing"),
          commands: [stopRecorder, cancelStt, commit(discard("no_audio"))],
          projection: proj("stopping", "dismiss", "user", discard("no_audio")),
        },
      },
      noopStep(
        { type: "noAudioDetected", session: S },
        settling(discard("no_audio"), "committing"),
        proj("stopping", "dismiss", "user", discard("no_audio")),
      ),
    ],
  },
  {
    name: "terminal verb in STARTING seals discard(interrupted_start)",
    given: starting,
    steps: [
      {
        event: { type: "dismissRequested", session: S },
        expect: {
          state: settling(discard("interrupted_start"), "committing"),
          commands: [stopRecorder, commit(discard("interrupted_start"))],
          projection: proj(
            "stopping",
            "dismiss",
            "user",
            discard("interrupted_start"),
          ),
        },
      },
    ],
  },
  {
    name: "start deadline seals a visible failure, then settles to idle",
    given: starting,
    steps: [
      {
        event: { type: "expired", session: S, stage: "starting" },
        expect: {
          state: settling(failureStartTimeout, "committing"),
          commands: [stopRecorder, commit(failureStartTimeout)],
          projection: proj("stopping", "finalize", "user", failureStartTimeout),
        },
      },
      {
        event: { type: "storageFinished", session: S },
        expect: { state: idle, commands: [], projection: proj("idle") },
      },
    ],
  },
  {
    name: "capture-start failure seals failure(cause)",
    given: starting,
    steps: [
      {
        event: { type: "recorderFailed", session: S, cause: CAUSE },
        expect: {
          state: settling(failureCause, "committing"),
          commands: [commit(failureCause)],
          projection: proj("stopping", "finalize", "user", failureCause),
        },
      },
    ],
  },
  {
    name: "quick-release cancel is legal only in RECORDING",
    given: recording,
    steps: [
      {
        event: { type: "cancelRequested", session: S, reason: "quick_release" },
        expect: {
          state: settling(discard("quick_release"), "committing"),
          commands: [stopRecorder, cancelStt, commit(discard("quick_release"))],
          projection: proj(
            "stopping",
            "dismiss",
            "user",
            discard("quick_release"),
          ),
        },
      },
    ],
  },
  {
    name: "quick-release cancel arriving post-stop no-ops",
    given: resolving(false),
    steps: [
      noopStep(
        { type: "cancelRequested", session: S, reason: "quick_release" },
        resolving(false),
        proj("stopping", "finalize", "user"),
      ),
    ],
  },
  {
    name: "max-duration cap: stopOrigin=auto is visible at RESOLVING entry and carries into SETTLING",
    given: recording,
    steps: [
      {
        event: { type: "expired", session: S, stage: "recording" },
        expect: {
          state: resolving(false, true),
          commands: [stopRecorder],
          projection: proj("stopping", "finalize", "auto"),
        },
      },
      {
        event: { type: "recorderClosed", session: S },
        expect: {
          state: resolving(true, true),
          commands: [finalizeStt],
          projection: proj("stopping", "finalize", "auto"),
        },
      },
      {
        event: finalText,
        expect: {
          state: settling(success, "committing", true),
          commands: [commit(success)],
          projection: proj("stopping", "finalize", "auto", success),
        },
      },
    ],
  },
];
