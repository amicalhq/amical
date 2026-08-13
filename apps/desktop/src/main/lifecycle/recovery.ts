import type { SealedOutcome } from "./types";

export const RECOVERY_INTERRUPTED_CAUSE = "interrupted";

/**
 * Startup-recovery disposition — the one standalone pure outcome decision.
 * Runs when no machine exists (posthumous, over custody artifacts found on
 * disk): a row with captured audio keeps it as a re-transcribable failure;
 * a row with no audio artifact is deleted — there is nothing to keep or
 * retry. Existence, not content: audio is never judged for audibility.
 */
export function decideRecovery(input: {
  hasCapturedAudio: boolean;
}): SealedOutcome {
  return input.hasCapturedAudio
    ? { kind: "failure", cause: RECOVERY_INTERRUPTED_CAUSE }
    : { kind: "discard", reason: "no_audio" };
}
