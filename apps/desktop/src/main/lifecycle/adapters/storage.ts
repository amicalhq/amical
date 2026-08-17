import { unlink } from "node:fs/promises";
import { Effect } from "effect";
import { logger } from "../../logger";
import { incrementDailyStats } from "../../../db/daily-stats";
import {
  deleteProvisionalTranscription,
  insertSettledTranscription,
  stampTranscriptionDisposition,
} from "../../../db/transcriptions";
import { countWords } from "../../../utils/dictation-stats";
import {
  createSessionWork,
  ensuringFact,
  type SessionWork,
} from "../effect/session-work";
import type { LifecycleFactSink, StoragePort } from "../ports";
import { REAL_TIMER_HOST, type ShellTimerHost } from "../shell";
import type { SealedOutcome, SessionId } from "../types";
import type { CustodyOutcome } from "./recorder";

/**
 * StoragePort — stamps the sealed outcome onto the session's custody row
 * (record before reveal, R7).
 *
 * Custody-ordered (D25): every commit first waits (bounded) for the
 * session's WAV writer to settle, so a settled row always has settled
 * custody — no surface can ever see a row whose audio is still being
 * written, and a crash before the stamp leaves an unstamped row that the
 * startup sweep repairs. When the writer failed, the row is settled
 * WITHOUT an audio reference and the broken file is unlinked. When the
 * provisional row itself is missing (insert failed, or custody never
 * opened), retained outcomes insert a settled row directly — a delivered
 * transcript can never vanish from history, and every retained outcome
 * leaves its terminal row (§3.4).
 *
 * Fate mapping, carried from v1 persistence semantics:
 *   success   → settle text, keep audio, count words + transcription
 *   empty     → settle,      keep audio, count the transcription (zero words)
 *   failure   → settle + failureReason, keep audio, count the transcription
 *   dismissed → settle,      keep audio, no stats (deliberate discard)
 *   discard   → delete the row and its audio; the session never happened
 *
 * storageFinished fires on failure too (D15) — the machine's course is
 * identical, and a known failure must not masquerade as a wedged port;
 * repair stays the port's business (one background retry, then the
 * startup sweep as ultimate net).
 */
export function createStorageAdapter(
  sink: LifecycleFactSink,
  options?: {
    timers?: ShellTimerHost;
    repairDelayMs?: number;
    /** Resolves with what custody holds once the WAV writer closed (D25). */
    awaitCustodySettled?: (session: SessionId) => Promise<CustodyOutcome>;
    /** Upper bound on the custody wait; a wedged writer delays the stamp,
     * never holds it hostage. */
    custodySettleBoundMs?: number;
    sessionWork?: SessionWork;
  },
): StoragePort {
  const timers = options?.timers ?? REAL_TIMER_HOST;
  const repairDelayMs = options?.repairDelayMs ?? 5_000;
  const custodySettleBoundMs = options?.custodySettleBoundMs ?? 10_000;
  const sessionWork = options?.sessionWork ?? createSessionWork({ timers });

  /** null = custody state unknown (no waiter wired, or the bound fired):
   * stamp as-is and never destroy references based on ignorance. */
  async function settleCustody(
    session: SessionId,
  ): Promise<CustodyOutcome | null> {
    const wait = options?.awaitCustodySettled?.(session);
    if (!wait) return null;
    // A race, not a hand-rolled latch: the loser is interrupted, and the
    // sleep's canceller clears its port timer (armed-set parity, E2).
    const read = Effect.tryPromise({
      try: () => wait,
      catch: () => null,
    }).pipe(Effect.catchAll(() => Effect.succeed<CustodyOutcome | null>(null)));
    const bound = sessionWork.sleep(custodySettleBoundMs).pipe(
      Effect.tap(() =>
        Effect.sync(() =>
          logger.audio.error("Custody settle bound hit; stamping anyway", {
            sessionId: session,
          }),
        ),
      ),
      Effect.as<CustodyOutcome | null>(null),
    );
    return Effect.runPromise(Effect.race(read, bound));
  }

  async function settleRetained(
    session: SessionId,
    sealed: Exclude<SealedOutcome, { kind: "discard" }>,
    custody: CustodyOutcome | null,
  ): Promise<void> {
    const text = sealed.kind === "success" ? sealed.text : undefined;
    const metaPatch =
      sealed.kind === "failure" ? { failureReason: sealed.cause } : undefined;
    // A broken WAV must never be advertised by a settled row.
    const stripAudio = custody !== null && !custody.wavOk;

    const row = await stampTranscriptionDisposition(session, {
      disposition: sealed.kind,
      text,
      metaPatch,
      ...(stripAudio ? { audioFile: null } : {}),
    });

    if (!row) {
      // No provisional row (insert failed, or custody never opened): every
      // retained outcome still leaves its terminal row (§3.4) — a pasted
      // transcript must never vanish from history.
      await insertSettledTranscription({
        sessionId: session,
        disposition: sealed.kind,
        text,
        metaPatch,
        audioFile: custody !== null && custody.wavOk ? custody.audioFile : null,
      });
    }

    if (stripAudio && custody.audioFile) {
      await unlink(custody.audioFile).catch(() => {
        // Best-effort: the broken file may not exist at all.
      });
    }

    if (sealed.kind === "success") {
      await countTranscription(session, countWords(sealed.text));
    } else if (sealed.kind === "empty" || sealed.kind === "failure") {
      await countTranscription(session, 0);
    }
  }

  async function commitSealed(
    session: SessionId,
    sealed: SealedOutcome,
  ): Promise<void> {
    const custody = await settleCustody(session);

    if (sealed.kind === "discard") {
      const row = await deleteProvisionalTranscription(session);
      const audioFile = row?.audioFile ?? custody?.audioFile ?? null;
      if (audioFile) {
        // Custody has settled: the writer no longer owns the file (R4).
        await unlink(audioFile).catch(() => {
          // Missing file is an acceptable end state for a discard.
        });
      }
      return;
    }

    await settleRetained(session, sealed, custody);
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
      // The settle→stamp→count chain is one obligation fiber; its ensuring
      // fact is storageFinished on BOTH paths (D15) — a known failure must
      // not look like a wedged port. The fact belongs to the FIRST attempt
      // only: the repair retry (raw timer, app-level, quarantine-lite)
      // never re-emits, and the startup sweep stays the ultimate net.
      const attempt = Effect.tryPromise({
        try: () => commitSealed(session, sealed),
        catch: (error) => error,
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.transcription.error("Lifecycle commit failed", {
              sessionId: session,
              sealedKind: sealed.kind,
              error,
            });
            timers.set(repairDelayMs, () => {
              void commitSealed(session, sealed).catch((repairError) => {
                logger.transcription.error(
                  "Lifecycle commit repair failed; startup recovery will settle the row",
                  { sessionId: session, error: repairError },
                );
              });
            });
          }),
        ),
      );
      sessionWork.runObligation(
        session,
        ensuringFact(attempt, () => sink({ type: "storageFinished", session })),
      );
    },
  };
}
