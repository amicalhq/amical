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
 * (record before reveal, R6).
 *
 * Fate mapping, carried from v1 persistence semantics:
 *   success   → stamp text, keep audio, count words + transcription
 *   empty     → stamp,      keep audio, count the transcription (zero words)
 *   failure   → stamp + failureReason, keep audio, count the transcription
 *   dismissed → stamp,      keep audio, no stats (deliberate discard)
 *   discard   → delete the row and its audio; the session never happened
 *
 * A session that never opened custody (no first byte) has nothing to stamp:
 * storageFinished is reported immediately. A db error reports nothing — the
 * committing grace bound degrades forward, one background retry repairs the
 * row (quarantine-lite), and the startup sweep is the ultimate net.
 */
export function createStorageAdapter(
  sink: LifecycleFactSink,
  options?: { timers?: ShellTimerHost; repairDelayMs?: number },
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
          await unlink(row.audioFile).catch(() => {
            // Missing file is an acceptable end state for a discard.
          });
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
          // Quarantine-lite: one silent background retry. No fact either
          // way — the grace bound already advanced the machine, and a
          // stale storageFinished would be a fenced no-op anyway.
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
