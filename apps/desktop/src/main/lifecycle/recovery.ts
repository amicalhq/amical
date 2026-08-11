import type { SealedOutcome } from "./types";

export const RECOVERY_INTERRUPTED_CAUSE = "interrupted";

/**
 * Startup-recovery disposition — the one standalone pure outcome decision.
 * Runs when no machine exists (posthumous, over custody artifacts found on
 * disk): a session that died unsealed keeps its audio as a re-transcribable
 * failure, or deletes it when nothing audible was captured. What counts as
 * "audible" is the caller's platform signal policy.
 */
export function decideRecovery(input: {
  hasAudibleAudio: boolean;
}): SealedOutcome {
  return input.hasAudibleAudio
    ? { kind: "failure", cause: RECOVERY_INTERRUPTED_CAUSE }
    : { kind: "discard", reason: "no_audio" };
}
