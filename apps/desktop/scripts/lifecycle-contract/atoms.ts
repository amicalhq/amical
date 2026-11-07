import type {
  LifecycleEvent,
  LifecycleState,
  SealedOutcome,
} from "../../src/main/lifecycle/types";

/**
 * Concrete atom domains for the lifecycle contract. Atoms enumerate every
 * payload that affects transition selection; opaque payloads (causes, text)
 * are pinned by shape with fixed representative values that ports treat as
 * pass-through.
 *
 * Session representatives: "s" = the live session, "x" = a stale session
 * (Rule 0 fencing rows), "n" = a fresh shell-minted id (admission rows).
 */

export const CURRENT_SESSION = "s";
export const STALE_SESSION = "x";
export const FRESH_SESSION = "n";
export const REPRESENTATIVE_TEXT = "text";
export const REPRESENTATIVE_CAUSE = "cause";

const EXPECTED_STATE_COUNT = 35;
const EXPECTED_EVENT_COUNT = 37;
export const EXPECTED_VECTOR_COUNT =
  EXPECTED_STATE_COUNT * EXPECTED_EVENT_COUNT;

const SEALED_ATOMS = {
  success: { kind: "success", text: REPRESENTATIVE_TEXT },
  empty: { kind: "empty" },
  failure: { kind: "failure", cause: REPRESENTATIVE_CAUSE },
  dismissed: { kind: "dismissed" },
  discard_quick_release: { kind: "discard", reason: "quick_release" },
  discard_no_audio: { kind: "discard", reason: "no_audio" },
  discard_interrupted_start: {
    kind: "discard",
    reason: "interrupted_start",
  },
} as const satisfies Record<string, SealedOutcome>;

type SealedAtomKey = keyof typeof SEALED_ATOMS;

function sealedAtomKey(sealed: SealedOutcome): SealedAtomKey {
  switch (sealed.kind) {
    case "success":
    case "empty":
    case "failure":
    case "dismissed":
      return sealed.kind;
    case "discard":
      return `discard_${sealed.reason}`;
  }
}

function buildStateAtoms(): Record<string, LifecycleState> {
  const atoms: Record<string, LifecycleState> = {
    IDLE: { tag: "IDLE" },
    STARTING: { tag: "STARTING", session: CURRENT_SESSION },
    RECORDING: { tag: "RECORDING", session: CURRENT_SESSION },
  };
  for (const recorderClosed of [false, true]) {
    for (const autoStopped of [false, true]) {
      atoms[`RESOLVING:${recorderClosed}:${autoStopped}`] = {
        tag: "RESOLVING",
        session: CURRENT_SESSION,
        recorderClosed,
        autoStopped,
      };
    }
  }
  for (const sealedKey of Object.keys(SEALED_ATOMS) as SealedAtomKey[]) {
    for (const stage of ["committing", "staging"] as const) {
      for (const autoStopped of [false, true]) {
        atoms[`SETTLING:${sealedKey}:${stage}:${autoStopped}`] = {
          tag: "SETTLING",
          session: CURRENT_SESSION,
          sealed: SEALED_ATOMS[sealedKey],
          stage,
          autoStopped,
        };
      }
    }
  }
  return atoms;
}

function buildEventAtoms(): Record<string, LifecycleEvent> {
  const atoms: Record<string, LifecycleEvent> = {};
  atoms[`startRequested:${CURRENT_SESSION}`] = {
    type: "startRequested",
    session: CURRENT_SESSION,
  };
  atoms[`startRequested:${FRESH_SESSION}`] = {
    type: "startRequested",
    session: FRESH_SESSION,
  };

  const sessions = [CURRENT_SESSION, STALE_SESSION] as const;
  for (const session of sessions) {
    atoms[`stopRequested:${session}`] = { type: "stopRequested", session };
    atoms[`dismissRequested:${session}`] = {
      type: "dismissRequested",
      session,
    };
    atoms[`cancelRequested:quick_release:${session}`] = {
      type: "cancelRequested",
      session,
      reason: "quick_release",
    };
    atoms[`recorderReady:${session}`] = { type: "recorderReady", session };
    atoms[`recorderFailed:${session}`] = {
      type: "recorderFailed",
      session,
      cause: REPRESENTATIVE_CAUSE,
    };
    atoms[`recorderClosed:${session}`] = { type: "recorderClosed", session };
    atoms[`noAudioDetected:${session}`] = { type: "noAudioDetected", session };
    atoms[`transcriptionFinal:text:${session}`] = {
      type: "transcriptionFinal",
      session,
      result: { kind: "text", text: REPRESENTATIVE_TEXT },
    };
    atoms[`transcriptionFinal:empty:${session}`] = {
      type: "transcriptionFinal",
      session,
      result: { kind: "empty" },
    };
    atoms[`transcriptionFinal:failure:${session}`] = {
      type: "transcriptionFinal",
      session,
      result: { kind: "failure", cause: REPRESENTATIVE_CAUSE },
    };
    atoms[`storageFinished:${session}`] = { type: "storageFinished", session };
    atoms[`deliveryStaged:${session}`] = { type: "deliveryStaged", session };
    for (const stage of [
      "starting",
      "recording",
      "resolving",
      "committing",
      "staging",
    ] as const) {
      atoms[`expired:${stage}:${session}`] = {
        type: "expired",
        session,
        stage,
      };
    }
  }

  atoms.forceReset = { type: "forceReset" };
  return atoms;
}

export const LIFECYCLE_STATE_ATOMS = buildStateAtoms();
export const LIFECYCLE_EVENT_ATOMS = buildEventAtoms();

export function assertLifecycleAtomManifests(): void {
  const stateCount = Object.keys(LIFECYCLE_STATE_ATOMS).length;
  const eventCount = Object.keys(LIFECYCLE_EVENT_ATOMS).length;
  if (stateCount !== EXPECTED_STATE_COUNT) {
    throw new Error(
      `Lifecycle state manifest has ${stateCount} atoms; expected ${EXPECTED_STATE_COUNT}`,
    );
  }
  if (eventCount !== EXPECTED_EVENT_COUNT) {
    throw new Error(
      `Lifecycle event manifest has ${eventCount} atoms; expected ${EXPECTED_EVENT_COUNT}`,
    );
  }
}

export function encodeLifecycleStateAtom(state: LifecycleState): string {
  switch (state.tag) {
    case "IDLE":
    case "STARTING":
    case "RECORDING":
      return state.tag;
    case "RESOLVING":
      return `RESOLVING:${state.recorderClosed}:${state.autoStopped}`;
    case "SETTLING":
      return `SETTLING:${sealedAtomKey(state.sealed)}:${state.stage}:${state.autoStopped}`;
  }
}

export function encodeLifecycleEventAtom(event: LifecycleEvent): string {
  switch (event.type) {
    case "forceReset":
      return event.type;
    case "cancelRequested":
      return `${event.type}:${event.reason}:${event.session}`;
    case "transcriptionFinal":
      return `${event.type}:${event.result.kind}:${event.session}`;
    case "expired":
      return `${event.type}:${event.stage}:${event.session}`;
    default:
      return `${event.type}:${event.session}`;
  }
}
