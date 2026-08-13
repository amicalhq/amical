import { unlink } from "node:fs/promises";
import { logger } from "../../logger";
import { incrementDailyStats } from "../../../db/daily-stats";
import {
  deleteProvisionalTranscription,
  stampTranscriptionDisposition,
} from "../../../db/transcriptions";
import { countWords } from "../../../utils/dictation-stats";
import type { LifecycleFactSink, StoragePort } from "../ports";
import { REAL_TIMER_HOST, type ShellTimerHost } from "../shell";
import type { SealedOutcome, SessionId } from "../types";

/**
 * StoragePort — stamps the sealed outcome onto the session's custody row
 * (record before reveal, R7).
 *
 * Fate mapping, carried from v1 persistence semantics:
 *   success   → stamp text, keep audio, count words + transcription
 *   empty     → stamp,      keep audio, count the transcription (zero words)
 *   failure   → stamp + failureReason, keep audio, count the transcription
 *   dismissed → stamp,      keep audio, no stats (deliberate discard)
 *   discard   → delete the row; unlink its audio once custody has closed
 *               (the writer owns the WAV until then — never race it)
 *
 * A session that never opened custody (no first byte) has nothing to stamp:
 * storageFinished is reported immediately. storageFinished fires on failure
 * too (D15) — the machine's course is identical either way, and a known
 * failure must not masquerade as a wedged port; repair stays the port's
 * business (one background retry, then the startup sweep as ultimate net).
 */
export function createStorageAdapter(
  sink: LifecycleFactSink,
  options?: {
    timers?: ShellTimerHost;
    repairDelayMs?: number;
    /** Resolves when the session's WAV writer has closed (R4 ordering). */
    awaitCustodySettled?: (session: SessionId) => Promise<void>;
  },
): StoragePort {
  const timers = options?.timers ?? REAL_TIMER_HOST;
  const repairDelayMs = options?.repairDelayMs ?? 5_000;
  async function commitSealed(
    session: SessionId,
    sealed: SealedOutcome,
  ): Promise<void> {
    switch (sealed.kind) {
      case "success": {
        const row = await stampTranscriptionDisposition(session, {
          disposition: "success",
          text: sealed.text,
        });
        if (row) await countTranscription(session, countWords(sealed.text));
        return;
      }
      case "empty": {
        const row = await stampTranscriptionDisposition(session, {
          disposition: "empty",
        });
        if (row) await countTranscription(session, 0);
        return;
      }
      case "failure": {
        const row = await stampTranscriptionDisposition(session, {
          disposition: "failure",
          metaPatch: { failureReason: sealed.cause },
        });
        if (row) await countTranscription(session, 0);
        return;
      }
      case "dismissed": {
        await stampTranscriptionDisposition(session, {
          disposition: "dismissed",
        });
        return;
      }
      case "discard": {
        const row = await deleteProvisionalTranscription(session);
        if (row?.audioFile) {
          const audioFile = row.audioFile;
          // The custody writer owns the WAV until it closes; unlink after,
          // off the commit path so storageFinished is never held up.
          const settled =
            options?.awaitCustodySettled?.(session) ?? Promise.resolve();
          void settled
            .catch(() => undefined)
            .then(() =>
              unlink(audioFile).catch(() => {
                // Missing file is an acceptable end state for a discard.
              }),
            );
        }
        return;
      }
    }
  }

  async function countTranscription(
    session: SessionId,
    wordCount: number,
  ): Promise<void> {
    try {
      await incrementDailyStats(wordCount);
    } catch (error) {
      logger.transcription.error("Failed to increment dictation stats", {
        sessionId: session,
        error,
      });
    }
  }

  return {
    commit(session, sealed): void {
      void commitSealed(session, sealed)
        .then(() => sink({ type: "storageFinished", session }))
        .catch((error) => {
          logger.transcription.error("Lifecycle commit failed", {
            sessionId: session,
            sealedKind: sealed.kind,
            error,
          });
          // The attempt settled (failed): report the fact (D15) so the
          // machine moves on immediately instead of eating the grace bound
          // — a known failure must not look like a wedged port. Repair is
          // port business: one silent background retry (quarantine-lite),
          // then the startup sweep.
          sink({ type: "storageFinished", session });
          timers.set(repairDelayMs, () => {
            void commitSealed(session, sealed).catch((repairError) => {
              logger.transcription.error(
                "Lifecycle commit repair failed; startup recovery will settle the row",
                { sessionId: session, error: repairError },
              );
            });
          });
        });
    },
  };
}
