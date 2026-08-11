import type { LifecycleState, SealedOutcome } from "./types";

/**
 * Shared pure projections — the surfaces' whole signal vocabulary. Emitted by
 * the shell on change (structural comparison), between commit and dispatch.
 * `terminal` fires once at the seal by construction; `stopOrigin` is visible
 * at RESOLVING entry, the moment the user must learn the cap fired.
 */

export type PublicState = "idle" | "starting" | "recording" | "stopping";
export type StopKind = "none" | "finalize" | "dismiss";
export type StopOrigin = "none" | "user" | "auto";

export interface LifecycleProjection {
  publicState: PublicState;
  stopKind: StopKind;
  stopOrigin: StopOrigin;
  terminal: SealedOutcome | null;
}

export function publicStateFor(state: LifecycleState): PublicState {
  switch (state.tag) {
    case "IDLE":
      return "idle";
    case "STARTING":
      return "starting";
    case "RECORDING":
      return "recording";
    case "RESOLVING":
    case "SETTLING":
      return "stopping";
  }
}

export function stopKindFor(state: LifecycleState): StopKind {
  switch (state.tag) {
    case "RESOLVING":
      return "finalize";
    case "SETTLING":
      return state.sealed.kind === "dismissed" ||
        state.sealed.kind === "discard"
        ? "dismiss"
        : "finalize";
    default:
      return "none";
  }
}

export function stopOriginFor(state: LifecycleState): StopOrigin {
  switch (state.tag) {
    case "RESOLVING":
    case "SETTLING":
      return state.autoStopped ? "auto" : "user";
    default:
      return "none";
  }
}

export function terminalFor(state: LifecycleState): SealedOutcome | null {
  return state.tag === "SETTLING" ? state.sealed : null;
}

export function projectLifecycle(state: LifecycleState): LifecycleProjection {
  return {
    publicState: publicStateFor(state),
    stopKind: stopKindFor(state),
    stopOrigin: stopOriginFor(state),
    terminal: terminalFor(state),
  };
}
