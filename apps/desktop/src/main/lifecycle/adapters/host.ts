import { Effect } from "effect";
import { logger } from "../../logger";
import { getLatestTranscription } from "../../../db/transcriptions";
import { ensuringFact, type SessionWork } from "../effect/session-work";
import {
  expectObligation,
  recordPhase,
  settleObligation,
} from "../../telemetry/dictation-trace";
import type { HostPort, LifecycleFactSink } from "../ports";
import type { SealedOutcome, SessionId } from "../types";

/**
 * HostPort — the single front door out of the lifecycle. stageDelivery runs
 * only after the record is committed (record before reveal, R7) and only
 * for delivering outcomes, so no delivery-authority re-check exists here:
 * the serialized queue already decided every race by the time this runs.
 *
 * The paste runs as an interruptible delivery span inside the staging
 * obligation (SessionWork): retirement — the IDLE edge, a staging expiry or
 * an R10 quarantine — kills the span at its next await, so a stale paste can
 * never land after the session died. The deliveryStaged fact is an ensuring
 * fact: it fires exactly once whether the span delivered, was refused or was
 * interrupted (the reducer waits on it — ports.ts).
 *
 * Draft sessions stage into the pending-draft store for review instead of
 * pasting; confirm/dismiss are post-lifecycle host actions (the machine is
 * IDLE by then — a review never blocks the next dictation) and therefore run
 * outside any session region, as does the paste-last-transcript shortcut.
 */

export interface PendingDraft {
  sessionId: SessionId;
  text: string;
}

export interface HostPasteBridge {
  /** Resolves with the helper's verdict: refusals arrive as
   * `{ success: false }`, not as rejections. */
  pasteText(options: {
    transcript: string;
    preserveClipboard: boolean;
  }): Promise<{ success: boolean }>;
  setDraftEnterCapture(armed: boolean): Promise<void>;
}

export interface HostAdapterDeps {
  sink: LifecycleFactSink;
  bridge: HostPasteBridge | null;
  getPreserveClipboard: () => Promise<boolean>;
  sessionWork: SessionWork;
  /** Whether the given (still-live) session is a draft review session. */
  isDraftSession: (session: SessionId) => boolean;
  /** Lifecycle idle probe for Enter-mask arming. */
  isLifecycleIdle: () => boolean;
  /** Grammar-side Enter routing arm (v1: shortcutManager.setDraftActive). */
  setDraftInputActive: (armed: boolean) => void;
}

export interface HostAdapter extends HostPort {
  /** R10 quarantine: retire the session's delivery region so an in-flight
   * paste dies at its next await and no new one can fork. Best-effort — a
   * paste already handed to the native layer cannot be recalled. */
  abandon(session: SessionId): void;
  getPendingDraft(): PendingDraft | null;
  confirmDraft(): Promise<void>;
  dismissDraft(): void;
  /** Re-evaluate the Enter mask; call on every lifecycle snapshot change. */
  syncDraftEnterMask(): void;
  /** The paste-last-transcript shortcut (not lifecycle work; lives with paste). */
  pasteLatestTranscription(): Promise<void>;
  onDraftChanged(listener: (draft: PendingDraft | null) => void): () => void;
}

export function createHostAdapter(deps: HostAdapterDeps): HostAdapter {
  let pendingDraft: PendingDraft | null = null;
  let draftEnterArmed = false;
  const draftListeners = new Set<(draft: PendingDraft | null) => void>();

  function setPendingDraft(draft: PendingDraft | null): void {
    pendingDraft = draft;
    for (const listener of draftListeners) {
      listener(draft);
    }
    syncDraftEnterMask();
  }

  /**
   * Arm Enter→Insert routing + the native Enter mask ONLY while a draft is
   * reviewable: a pending draft AND the lifecycle idle. During the
   * (re-)dictation that replaces a draft we are not idle, so Enter can never
   * insert the about-to-be-replaced text. Pushes only on actual flips.
   */
  function syncDraftEnterMask(): void {
    const armed = pendingDraft !== null && deps.isLifecycleIdle();
    if (armed === draftEnterArmed) return;
    draftEnterArmed = armed;
    deps.setDraftInputActive(armed);
    if (deps.bridge) {
      void deps.bridge.setDraftEnterCapture(armed).catch((error) => {
        logger.main.warn("Failed to sync draft enter mask", { error });
      });
    }
  }

  /** Hand the transcript to the native layer. Fire-and-forget by design:
   * once dispatched it cannot be recalled. `telemetry.dispatched` fires when
   * the native call is actually issued; `settled(confirmed)` fires when the
   * helper answers — confirmed ONLY for an acknowledged paste. A refusal
   * resolves as `{ success: false }` (both helpers report paste failure as a
   * result, never an RPC error) and settles unconfirmed. */
  function dispatchPaste(
    transcript: string,
    preserveClipboard: boolean,
    telemetry?: {
      dispatched: () => void;
      settled: (confirmed: boolean) => void;
    },
  ): void {
    if (!deps.bridge) {
      logger.main.warn("Native bridge unavailable, cannot paste");
      return;
    }
    telemetry?.dispatched();
    void deps.bridge.pasteText({ transcript, preserveClipboard }).then(
      (result) => {
        if (!result?.success) {
          logger.main.warn("Native helper refused the paste");
        }
        telemetry?.settled(!!result?.success);
      },
      (error) => {
        logger.main.warn("Failed to paste transcription via native helper", {
          error: error instanceof Error ? error.message : String(error),
        });
        telemetry?.settled(false);
      },
    );
  }

  /** Post-lifecycle paste (draft confirm, paste-latest): app-scope, never
   * fenced by session retirement. */
  async function paste(transcript: string): Promise<void> {
    if (!transcript) return;
    try {
      const preserveClipboard = await deps.getPreserveClipboard();
      dispatchPaste(transcript, preserveClipboard);
    } catch (error) {
      logger.main.warn("Failed to prepare paste", { error });
    }
  }

  /** The session-fenced delivery span: the preference read is the await a
   * retirement interrupts (the R9-1 window). A rejected read degrades like
   * the old catch — warn and skip, never fail the staging obligation.
   * `telemetry` reports the whole delivery (effect start → native answer);
   * the span itself must end at dispatch — the staged fact the reducer
   * waits on cannot hang on the native layer. */
  const pasteSpan = (
    transcript: string,
    telemetry: {
      dispatched: () => void;
      settled: (startedAt: number, confirmed: boolean) => void;
    },
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      const startedAt = Date.now();
      return Effect.tryPromise({
        try: () => deps.getPreserveClipboard(),
        catch: (error) => error,
      }).pipe(
        Effect.flatMap((preserveClipboard) =>
          Effect.sync(() =>
            dispatchPaste(transcript, preserveClipboard, {
              dispatched: telemetry.dispatched,
              settled: (confirmed) => telemetry.settled(startedAt, confirmed),
            }),
          ),
        ),
        Effect.catchAll((error) =>
          Effect.sync(() =>
            logger.main.warn("Failed to prepare paste", { error }),
          ),
        ),
      );
    });

  return {
    stageDelivery(session: SessionId, sealed: SealedOutcome): void {
      const emit = () => deps.sink({ type: "deliveryStaged", session });
      if (sealed.kind !== "success") {
        emit();
        return;
      }
      if (deps.isDraftSession(session)) {
        // Sync prefix: the still-live probe and the displacement write must
        // run before any await (the probe is only valid while the session
        // lives; a fiber hop would expose it to staleness).
        setPendingDraft({ sessionId: session, text: sealed.text });
        emit();
        return;
      }
      if (!sealed.text) {
        emit();
        return;
      }
      expectObligation(session, "delivery.paste");
      deps.sessionWork.runObligation(
        session,
        ensuringFact(
          deps.sessionWork
            .deliverySpan(
              session,
              pasteSpan(sealed.text, {
                // Expected from actual issuance: without it the trace flushes
                // synchronously at the IDLE edge — every other obligation is
                // already settled — and the helper's answer always lands
                // late, so the paste keys would never ship (review finding).
                // The trace waits, grace-bounded; the reducer never does.
                dispatched: () => expectObligation(session, "delivery.pasted"),
                settled: (startedAt, confirmed) =>
                  confirmed
                    ? recordPhase(
                        session,
                        "delivery.pasted",
                        startedAt,
                        Date.now(),
                      )
                    : settleObligation(session, "delivery.pasted"),
              }),
            )
            .pipe(
              Effect.withSpan("delivery.paste", {
                attributes: { sessionId: session },
              }),
            ),
          emit,
        ),
      );
    },

    abandon(session: SessionId): void {
      deps.sessionWork.quarantine(session);
    },

    getPendingDraft(): PendingDraft | null {
      return pendingDraft;
    },

    async confirmDraft(): Promise<void> {
      const pending = pendingDraft;
      setPendingDraft(null);
      if (pending?.text) {
        await paste(pending.text);
      }
    },

    dismissDraft(): void {
      setPendingDraft(null);
    },

    syncDraftEnterMask,

    async pasteLatestTranscription(): Promise<void> {
      try {
        const latest = await getLatestTranscription();
        if (!latest || !latest.text?.trim()) {
          logger.main.info("No previous transcription available to paste");
          return;
        }
        await paste(latest.text);
      } catch (error) {
        logger.main.warn("Failed to paste last transcription", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    onDraftChanged(listener) {
      draftListeners.add(listener);
      return () => draftListeners.delete(listener);
    },
  };
}
