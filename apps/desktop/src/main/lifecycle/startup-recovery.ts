import { open, stat, unlink } from "node:fs/promises";
import { logger } from "../logger";
import {
  deleteProvisionalTranscription,
  enrichTranscriptionBySession,
  getUncommittedTranscriptions,
  stampTranscriptionDisposition,
} from "../../db/transcriptions";
import { decideRecovery } from "./recovery";
import type { SessionId } from "./types";

/** A WAV with any payload past its 44-byte header counts as captured audio. */
const WAV_HEADER_BYTES = 44;

async function hasCapturedAudio(audioFile: string | null): Promise<boolean> {
  if (!audioFile) return false;
  try {
    return (await stat(audioFile)).size > WAV_HEADER_BYTES;
  } catch {
    return false;
  }
}

/** Custody WAV format: 16 kHz, 16-bit, mono. */
const WAV_BYTES_PER_SECOND = 32_000;

/**
 * A crashed session's writer never ran finalize, so its header still says
 * zero data and decoders read the kept WAV as empty. Patch the RIFF and
 * data sizes from the real file length; idempotent on finalized files.
 * Returns the payload size in bytes (0 when there is nothing to repair).
 */
async function repairWavHeader(audioFile: string): Promise<number> {
  const handle = await open(audioFile, "r+");
  try {
    const size = (await handle.stat()).size;
    if (size <= WAV_HEADER_BYTES) return 0;
    const sizes = Buffer.alloc(4);
    sizes.writeUInt32LE(size - 8, 0);
    await handle.write(sizes, 0, 4, 4); // RIFF chunk size
    sizes.writeUInt32LE(size - WAV_HEADER_BYTES, 0);
    await handle.write(sizes, 0, 4, 40); // data chunk size
    return size - WAV_HEADER_BYTES;
  } finally {
    await handle.close();
  }
}

/**
 * Settle custody rows the app died on (posthumous sealing via the shared
 * decide()). Domain is disk truth (D21): every row with a NULL disposition,
 * except the live session — a seal is real only once stamped. Rows whose
 * custody WAV holds audio keep it as a re-transcribable failure; rows with
 * no audio artifact are deleted. Runs at startup, and doubles as the
 * quarantine net for commit stamps that never landed.
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

    const verdict = decideRecovery({
      hasCapturedAudio: await hasCapturedAudio(row.audioFile),
    });
    try {
      if (verdict.kind === "failure") {
        if (row.audioFile) {
          // The crashed writer also never enriched duration; derive it from
          // the repaired payload so the row is whole like a normal one.
          const payloadBytes = await repairWavHeader(row.audioFile).catch(
            (error) => {
              logger.audio.warn("Failed to repair recovered WAV header", {
                sessionId,
                error,
              });
              return 0;
            },
          );
          if (payloadBytes > 0) {
            await enrichTranscriptionBySession(sessionId, {
              duration: Math.round(payloadBytes / WAV_BYTES_PER_SECOND),
            }).catch(() => undefined);
          }
        }
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
