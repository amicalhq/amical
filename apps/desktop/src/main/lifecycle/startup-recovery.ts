import { unlink } from "node:fs/promises";
import { logger } from "../logger";
import {
  deleteProvisionalTranscription,
  getUncommittedTranscriptions,
  stampTranscriptionDisposition,
} from "../../db/transcriptions";
import { decideRecovery } from "./recovery";
import type { SessionId } from "./types";

/**
 * Settle custody rows the app died on (posthumous sealing via the shared
 * decide()): audible sessions keep their audio as a re-transcribable
 * failure row; silent ones are deleted with their WAV. Runs at startup,
 * and doubles as the quarantine net for commit stamps that never landed.
 */
export async function runLifecycleRecovery(options?: {
  /** Never touch the live session's row (in-app repair runs). */
  excludeSession?: SessionId | null;
}): Promise<{ recovered: number; discarded: number }> {
  let recovered = 0;
  let discarded = 0;

  const rows = await getUncommittedTranscriptions();
  for (const row of rows) {
    const sessionId = row.sessionId;
    if (!sessionId || sessionId === options?.excludeSession) continue;

    const verdict = decideRecovery({ hasAudibleAudio: row.audible === true });
    try {
      if (verdict.kind === "failure") {
        await stampTranscriptionDisposition(sessionId, {
          disposition: "failure",
          metaPatch: { failureReason: verdict.cause },
        });
        recovered++;
      } else {
        const deleted = await deleteProvisionalTranscription(sessionId);
        if (deleted?.audioFile) {
          await unlink(deleted.audioFile).catch(() => {
            // The WAV may never have been finalized; a missing file is fine.
          });
        }
        discarded++;
      }
    } catch (error) {
      logger.audio.error("Failed to settle abandoned custody row", {
        sessionId,
        verdict: verdict.kind,
        error,
      });
    }
  }

  if (recovered > 0 || discarded > 0) {
    logger.audio.info("Lifecycle recovery settled abandoned sessions", {
      recovered,
      discarded,
    });
  }
  return { recovered, discarded };
}
