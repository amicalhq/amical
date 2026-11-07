import type {
  LifecycleCommand,
  LifecycleState,
  LifecycleTransition,
  SealedOutcome,
  SessionId,
  TranscriptionResult,
} from "../types";

const EMPTY_COMMANDS = Object.freeze([]) as unknown as LifecycleCommand[];

/** No-op transition: same state reference, no commands. */
export function noop(state: LifecycleState): LifecycleTransition {
  return { state, commands: EMPTY_COMMANDS };
}

/** Entry into SETTLING always starts at the committing stage. */
export function sealedState(
  session: SessionId,
  sealed: SealedOutcome,
  autoStopped: boolean,
): LifecycleState {
  return { tag: "SETTLING", session, sealed, stage: "committing", autoStopped };
}

export function sealedFromResult(result: TranscriptionResult): SealedOutcome {
  switch (result.kind) {
    case "text":
      return { kind: "success", text: result.text };
    case "empty":
      return { kind: "empty" };
    case "failure":
      return { kind: "failure", cause: result.cause };
  }
}

/** Only success delivers (outcome table, architecture §3.4). */
export function outcomeDelivers(sealed: SealedOutcome): boolean {
  return sealed.kind === "success";
}
