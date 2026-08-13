import { logger } from "../../logger";
import { getLatestTranscription } from "../../../db/transcriptions";
import type { HostPort, LifecycleFactSink } from "../ports";
import type { SealedOutcome, SessionId } from "../types";

/**
 * HostPort — the single front door out of the lifecycle. stageDelivery runs
 * only after the record is committed (record before reveal, R7) and only
 * for delivering outcomes, so no delivery-authority re-check exists here:
 * the serialized queue already decided every race by the time this runs.
 *
 * Draft sessions stage into the pending-draft store for review instead of
 * pasting; confirm/dismiss are post-lifecycle host actions (the machine is
 * IDLE by then — a review never blocks the next dictation).
 */

export interface PendingDraft {
  sessionId: SessionId;
  text: string;
}

export interface HostPasteBridge {
  pasteText(options: {
    transcript: string;
    preserveClipboard: boolean;
  }): Promise<void>;
  setDraftEnterCapture(armed: boolean): Promise<void>;
}

export interface HostAdapterDeps {
  sink: LifecycleFactSink;
  bridge: HostPasteBridge | null;
  getPreserveClipboard: () => Promise<boolean>;
  /** Whether the given (still-live) session is a draft review session. */
  isDraftSession: (session: SessionId) => boolean;
  /** Lifecycle idle probe for Enter-mask arming. */
  isLifecycleIdle: () => boolean;
  /** Grammar-side Enter routing arm (v1: shortcutManager.setDraftActive). */
  setDraftInputActive: (armed: boolean) => void;
}

export interface HostAdapter extends HostPort {
  /** R10 quarantine: a forceReset injector abandons the session's staged
   * delivery BEFORE resetting, so an in-flight paste cannot land inside a
   * successor session. Best-effort — a paste already handed to the native
   * layer cannot be recalled. */
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
  const abandoned = new Set<SessionId>();

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

  async function paste(
    transcript: string,
    isAbandoned?: () => boolean,
  ): Promise<void> {
    if (!transcript) return;
    try {
      const preserveClipboard = await deps.getPreserveClipboard();
      if (!deps.bridge) {
        logger.main.warn("Native bridge unavailable, cannot paste");
        return;
      }
      // Re-check after the async gap: a forceReset quarantine may have
      // abandoned this session while preferences were being read.
      if (isAbandoned?.()) return;
      void deps.bridge
        .pasteText({ transcript, preserveClipboard })
        .catch((error) => {
          logger.main.warn("Failed to paste transcription via native helper", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      logger.main.warn("Failed to prepare paste", { error });
    }
  }

  return {
    stageDelivery(session: SessionId, sealed: SealedOutcome): void {
      void (async () => {
        if (sealed.kind === "success" && !abandoned.has(session)) {
          if (deps.isDraftSession(session)) {
            setPendingDraft({ sessionId: session, text: sealed.text });
          } else {
            await paste(sealed.text, () => abandoned.has(session));
          }
        }
        deps.sink({ type: "deliveryStaged", session });
      })();
    },

    abandon(session: SessionId): void {
      abandoned.add(session);
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
