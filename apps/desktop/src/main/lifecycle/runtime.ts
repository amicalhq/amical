import { logger } from "../logger";
import { ErrorCodes, type ErrorCode } from "../../types/error";
import {
  createProvisionalTranscription,
  enrichTranscriptionBySession,
} from "../../db/transcriptions";
import {
  createRecorderAdapter,
  type CapturedMicrophone,
  type RecorderAdapter,
  type RecorderAdapterDeps,
  type RecorderAmbiance,
} from "./adapters/recorder";
import { createStorageAdapter } from "./adapters/storage";
import {
  createTranscriptionAdapter,
  type StreamingTranscriptionService,
  type TranscriptionAdapter,
  type TranscriptionFailureDetail,
} from "./adapters/transcription";
import {
  createHostAdapter,
  type HostAdapter,
  type HostPasteBridge,
  type PendingDraft,
} from "./adapters/host";
import { createGrammarHost, type GrammarHost } from "./grammar-host";
import type { LifecycleSessionMeta, RecordingMode } from "./metadata";
import type { LifecycleProjection } from "./projection";
import {
  createLifecycleShell,
  REAL_TIMER_HOST,
  type LifecycleShell,
  type LifecycleSnapshot,
  type ShellTimerHost,
} from "./shell";
import { wedgeBudgetMs, type LifecycleTuning } from "./tuning";
import { type CancelReason, type SessionId } from "./types";

/**
 * Recording lifecycle runtime — assembles shell + ports + grammar into the
 * one object the rest of the app talks to. Everything here is wiring and
 * surface policy (admission gates, notification derivation, draft glue);
 * every lifecycle decision stays in the reducer.
 */

/** Raw notification event; the recording router shapes it for the widget. */
export interface LifecycleNotification {
  type:
    | "no_audio"
    | "empty_transcript"
    | "transcription_failed"
    | "recording_duration_warning"
    | "recording_auto_stopped";
  params?: Record<string, string | number>;
  errorCode?: ErrorCode;
  /** transcription_failed only: the failure sealed before recording began,
   * so there is no saved recording for the toast to point at. */
  noRecording?: boolean;
  uiTitle?: string;
  uiMessage?: string;
  traceId?: string;
}

export interface RecordingLifecycleDeps {
  transcriptionService: StreamingTranscriptionService & {
    isHistoryRetryInProgress(): boolean;
  };
  ambiance: RecorderAmbiance;
  bridge: HostPasteBridge | null;
  getPreserveClipboard: () => Promise<boolean>;
  hasSpeechModelSelected: () => Promise<boolean>;
  /** Second-binding (draft chord) level, polled at start and per chunk. */
  isDraftChordActive: () => boolean;
  /** Grammar-side Enter routing arm (shortcut-manager draft mode). */
  setDraftInputActive: (armed: boolean) => void;
  audioFilePathFor: (session: SessionId) => string;
  tuning: LifecycleTuning;
  timers?: ShellTimerHost;
  mintSession: () => SessionId;
  /** Test seam; production uses the streaming WAV writer. */
  createWavWriter?: RecorderAdapterDeps["createWavWriter"];
}

export interface RecordingLifecycle {
  // Input side (shortcut wiring + tRPC verbs)
  setPttLevel(engaged: boolean): void;
  toggleKey(): void;
  /** Surface start (FAB, notes): hands-free, routed through the grammar so
   * drive state stays consistent with every other start. Start-only — a
   * stray call during a live session is a no-op, never a stop. */
  startDictation(): Promise<void>;
  stopDictation(): Promise<void>;
  dismiss(): Promise<void>;
  confirmDraftFromInput(): Promise<void>;
  forceReset(): void;

  // Renderer capture handshake + chunk traffic
  captureStarted(session: SessionId, microphone: CapturedMicrophone): void;
  captureStartFailed(
    session: SessionId,
    failure: { name?: string; message: string },
  ): void;
  handleAudioChunk(
    session: SessionId,
    chunk: Float32Array,
    isFinalChunk: boolean,
  ): Promise<void>;

  // Surface state
  getSnapshot(): LifecycleSnapshot<LifecycleSessionMeta>;
  onSnapshot(
    listener: (snapshot: LifecycleSnapshot<LifecycleSessionMeta>) => void,
  ): () => void;
  onNotification(listener: (event: LifecycleNotification) => void): () => void;

  // Draft review (post-lifecycle host actions)
  getPendingDraft(): PendingDraft | null;
  confirmDraft(): Promise<void>;
  dismissDraft(): void;
  onDraftChanged(listener: (draft: PendingDraft | null) => void): () => void;
  pasteLatestTranscription(): Promise<void>;

  dispose(): void;
}

export function createRecordingLifecycle(
  deps: RecordingLifecycleDeps,
): RecordingLifecycle {
  const timers = deps.timers ?? REAL_TIMER_HOST;

  let recorder!: RecorderAdapter;
  let transcription!: TranscriptionAdapter;
  let host!: HostAdapter;

  const notificationListeners = new Set<
    (event: LifecycleNotification) => void
  >();
  function notify(event: LifecycleNotification): void {
    if (event.type === "transcription_failed") {
      event = { ...event, noRecording: recordingStartedAt === null };
    }
    for (const listener of notificationListeners) {
      listener(event);
    }
  }

  const failureDetails = new Map<SessionId, TranscriptionFailureDetail>();

  const shell: LifecycleShell<LifecycleSessionMeta> = createLifecycleShell({
    tuning: deps.tuning,
    timers,
    mintSession: deps.mintSession,
    onTransition: (event, before, after, commands) => {
      logger.audio.debug("Lifecycle transition", {
        event: event.type,
        before: before.tag,
        after: after.tag,
        commands: commands.map((command) => command.type),
      });
    },
    onPortError: (command, error) => {
      logger.audio.error("Lifecycle port command failed", {
        command: command.type,
        sessionId: "session" in command ? command.session : undefined,
        error,
      });
    },
    ports: (sink) => {
      transcription = createTranscriptionAdapter({
        sink,
        service: deps.transcriptionService,
        enrich: (session, fields) =>
          enrichTranscriptionBySession(session, {
            language: fields.language ?? undefined,
            detectedLanguage: fields.detectedLanguage ?? undefined,
            speechModel: fields.speechModel ?? undefined,
            formattingModel: fields.formattingModel ?? undefined,
            metaPatch: fields.metaPatch,
          }).catch((error) => {
            // Enrichment is descriptive; a failure never blocks the fact.
            logger.transcription.error("Failed to enrich custody row", {
              sessionId: session,
              error,
            });
          }),
        onFailureDetail: (session, detail) => {
          failureDetails.set(session, detail);
        },
      });

      recorder = createRecorderAdapter({
        sink,
        tuning: deps.tuning,
        timers,
        ambiance: deps.ambiance,
        custody: {
          open: (session, audioFile) =>
            createProvisionalTranscription({
              sessionId: session,
              audioFile,
            }).then(() => undefined),
          enrich: (session, fields) =>
            enrichTranscriptionBySession(session, fields),
        },
        feed: (session, chunk) => {
          // v1 latch semantics: the draft chord tags the live session at
          // chunk time, so a chord completed just after start still counts.
          if (deps.isDraftChordActive()) {
            const snapshot = shell.getSnapshot();
            if (snapshot.sessionId === session && !snapshot.metadata?.isDraft) {
              shell.updateMetadata({ isDraft: true });
              transcription.setDraft(session, true);
            }
          }
          transcription.feed(session, chunk);
        },
        audioFilePathFor: deps.audioFilePathFor,
        createWavWriter: deps.createWavWriter,
      });

      host = createHostAdapter({
        sink,
        bridge: deps.bridge,
        getPreserveClipboard: deps.getPreserveClipboard,
        isDraftSession: (session) => {
          const snapshot = shell.getSnapshot();
          return (
            snapshot.sessionId === session &&
            snapshot.metadata?.isDraft === true
          );
        },
        isLifecycleIdle: () =>
          shell.getSnapshot().projection.publicState === "idle",
        setDraftInputActive: deps.setDraftInputActive,
      });

      return {
        recorder,
        transcription,
        storage: createStorageAdapter(sink, {
          timers,
          repairDelayMs: deps.tuning.commitRepairDelayMs,
          awaitCustodySettled: (session) =>
            recorder.whenCustodySettled(session),
          // Custody normally settles in ~ms (success path) or the drain
          // tail (mid-drain seals); the bound only covers a wedged writer.
          custodySettleBoundMs: deps.tuning.drainMs + 2_000,
        }),
        host,
      };
    },
  });

  /** R10: quarantine in-flight terminal work BEFORE the reset — an
   * abandoned delivery cannot land inside a successor session, and the
   * ports retire their streams instead of leaking them. */
  function quarantineAndForceReset(): void {
    const session = shell.getSnapshot().sessionId;
    if (session !== null) {
      host.abandon(session);
      transcription.cancel(session);
      recorder.stop(session);
    }
    shell.forceReset();
  }

  // Verb ordering: admission gates await async lookups, and a release can
  // arrive while its press is still being admitted. One chain keeps input
  // order without blocking the shell queue.
  let verbChain: Promise<void> = Promise.resolve();
  function enqueueVerb(work: () => void | Promise<void>): Promise<void> {
    verbChain = verbChain.then(work).catch((error) => {
      logger.audio.error("Lifecycle verb failed", { error });
    });
    return verbChain;
  }

  /** Admission gates must be bounded (D20): a hung gate may cost one
   * refused start, never the input queue. Rejections refuse too. */
  const ADMISSION_GATE_TIMEOUT_MS = 3_000;
  function boundedGate<T>(work: Promise<T>): Promise<T | "gate-timeout"> {
    return new Promise((resolve) => {
      let settled = false;
      const handle = timers.set(ADMISSION_GATE_TIMEOUT_MS, () => {
        if (settled) return;
        settled = true;
        resolve("gate-timeout");
      });
      work.then(
        (value) => {
          if (settled) return;
          settled = true;
          timers.clear(handle);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          timers.clear(handle);
          logger.audio.error("Admission gate failed", { error });
          resolve("gate-timeout");
        },
      );
    });
  }

  /** A refused start leaves the grammar idle: the grammar latched (or held)
   * on the press that produced this start, and no session will ever reset
   * it — without this, the next press is a wasted no-op stop. */
  function refuseStart(): void {
    grammar.notifyLifecycleIdle();
  }

  async function admitStart(mode: RecordingMode): Promise<void> {
    if (shell.getSnapshot().projection.publicState !== "idle") {
      refuseStart();
      return;
    }
    if (deps.transcriptionService.isHistoryRetryInProgress()) {
      notify({
        type: "transcription_failed",
        errorCode: ErrorCodes.RETRY_IN_PROGRESS,
      });
      refuseStart();
      return;
    }
    const modelSelected = await boundedGate(deps.hasSpeechModelSelected());
    if (modelSelected === "gate-timeout") {
      logger.audio.error("Admission gate timed out; start refused");
      notify({
        type: "transcription_failed",
        errorCode: ErrorCodes.UNKNOWN,
      });
      refuseStart();
      return;
    }
    if (!modelSelected) {
      notify({
        type: "transcription_failed",
        errorCode: ErrorCodes.MODEL_MISSING,
      });
      refuseStart();
      return;
    }
    // Re-check after the await: a history retry admitted during the model
    // lookup holds the engines — refuse with the truthful reason instead of
    // letting the session start and die on a refused stream.
    if (deps.transcriptionService.isHistoryRetryInProgress()) {
      notify({
        type: "transcription_failed",
        errorCode: ErrorCodes.RETRY_IN_PROGRESS,
      });
      refuseStart();
      return;
    }
    // Draft is sticky: dictating over a pending review replaces the draft
    // (PTT only — the grammar host drops toggle inputs while draft-blocked).
    const isDraft =
      deps.isDraftChordActive() || host.getPendingDraft() !== null;
    shell.requestStart({ mode, isDraft });
  }

  const isDraftBlocked = (): boolean =>
    host.getPendingDraft() !== null ||
    shell.getSnapshot().metadata?.isDraft === true;

  const grammar: GrammarHost = createGrammarHost({
    requestStart: (mode) => void enqueueVerb(() => admitStart(mode)),
    requestStop: () => void enqueueVerb(() => shell.requestStop()),
    requestCancel: (reason: CancelReason) =>
      void enqueueVerb(() => shell.requestCancel(reason)),
    // Through the verb chain like every other input (D20): an upgrade
    // arriving while its start is still being admitted queues behind the
    // admission and lands on the session it was meant for.
    modeChanged: (mode) =>
      void enqueueVerb(() => shell.updateMetadata({ mode })),
    isDraftBlocked,
    tuning: deps.tuning,
    timers,
  });

  // ── Snapshot-driven surface work ────────────────────────────────────────
  let previous = shell.getSnapshot();
  let reminderHandle: unknown | null = null;
  let wedgeHandle: unknown | null = null;
  // Recording duration, for the empty-notice gate (surface policy only).
  let recordingStartedAt: number | null = null;
  let recordingStoppedAt: number | null = null;

  function clearReminder(): void {
    if (reminderHandle !== null) {
      timers.clear(reminderHandle);
      reminderHandle = null;
    }
  }

  function clearWedgeWatchdog(): void {
    if (wedgeHandle !== null) {
      timers.clear(wedgeHandle);
      wedgeHandle = null;
    }
  }

  const unsubscribeSnapshots = shell.onSnapshot((snapshot) => {
    const prev = previous;
    previous = snapshot;
    const was = prev.projection;
    const now = snapshot.projection;

    // Stream opens with the session (warmup runs while capture spins up).
    if (
      was.publicState === "idle" &&
      now.publicState === "starting" &&
      snapshot.sessionId !== null
    ) {
      transcription.open(snapshot.sessionId);
      // Wedge watchdog: every stage is bounded, so a session outliving the
      // whole budget means a wedged timer or port — force-reset (R10).
      clearWedgeWatchdog();
      const session = snapshot.sessionId;
      wedgeHandle = timers.set(wedgeBudgetMs(deps.tuning), () => {
        wedgeHandle = null;
        if (shell.getSnapshot().sessionId === session) {
          logger.audio.error("Lifecycle wedge watchdog fired", { session });
          quarantineAndForceReset();
        }
      });
    }

    if (now.publicState === "recording" && was.publicState !== "recording") {
      recordingStartedAt = Date.now();
      recordingStoppedAt = null;
      clearReminder();
      reminderHandle = timers.set(deps.tuning.longRecordingReminderMs, () => {
        reminderHandle = null;
        const cap = deps.tuning.stageBoundsMs.recording;
        notify({
          type: "recording_duration_warning",
          params: {
            minutes: Math.round(
              (cap - deps.tuning.longRecordingReminderMs) / 60_000,
            ),
            maxMinutes: Math.round(cap / 60_000),
          },
        });
      });
    }
    if (was.publicState === "recording" && now.publicState !== "recording") {
      recordingStoppedAt = Date.now();
      clearReminder();
    }

    if (now.stopOrigin === "auto" && was.stopOrigin !== "auto") {
      notify({ type: "recording_auto_stopped" });
    }

    if (now.terminal && !was.terminal) {
      deriveTerminalNotification(now.terminal, snapshot);
    }

    if (now.publicState === "idle" && was.publicState !== "idle") {
      grammar.notifyLifecycleIdle();
      clearWedgeWatchdog();
      recordingStartedAt = null;
      recordingStoppedAt = null;
      failureDetails.clear();
    }

    host.syncDraftEnterMask();
  });

  function deriveTerminalNotification(
    terminal: NonNullable<LifecycleProjection["terminal"]>,
    snapshot: LifecycleSnapshot<LifecycleSessionMeta>,
  ): void {
    const microphone = snapshot.metadata?.microphone;
    switch (terminal.kind) {
      case "failure": {
        // Every failure seal surfaces (R3: never a silent reset) — timeout
        // causes included; unknown cause strings render the generic
        // failure copy via the surface's UNKNOWN fallback.
        const detail = snapshot.sessionId
          ? failureDetails.get(snapshot.sessionId)
          : undefined;
        notify({
          type: "transcription_failed",
          errorCode: terminal.cause as ErrorCode,
          uiTitle: detail?.uiTitle,
          uiMessage: detail?.uiMessage,
          traceId: detail?.traceId,
        });
        return;
      }
      case "empty": {
        // Surface gate (D24): recordings at or under the threshold stay
        // silent — an accidental mid-length press is not worth a toast.
        // Quick taps (<500ms) never get here (they discard); this covers
        // the interval between the quick window and the threshold.
        const durationMs =
          recordingStartedAt !== null && recordingStoppedAt !== null
            ? recordingStoppedAt - recordingStartedAt
            : 0;
        if (durationMs > deps.tuning.emptyNoticeMinRecordingMs) {
          notify({
            type: "empty_transcript",
            params: microphone ? { microphone } : undefined,
          });
        }
        return;
      }
      case "discard": {
        if (terminal.reason === "no_audio") {
          notify({
            type: "no_audio",
            params: microphone ? { microphone } : undefined,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  return {
    setPttLevel: (engaged) => grammar.setPttLevel(engaged),
    toggleKey: () => grammar.toggleKey(),
    startDictation: async () => grammar.startHandsFree(),
    stopDictation: () => enqueueVerb(() => shell.requestStop()),
    dismiss: () =>
      enqueueVerb(() => {
        // ESC closes a pending draft review first; otherwise it dismisses
        // the in-progress session (the reducer decides legality).
        if (host.getPendingDraft()) {
          host.dismissDraft();
          return;
        }
        shell.requestDismiss();
      }),
    confirmDraftFromInput: async () => {
      // Gated twice (arm + here): during a replacement dictation we are not
      // idle, so Enter can never insert the about-to-be-replaced text.
      if (
        host.getPendingDraft() &&
        shell.getSnapshot().projection.publicState === "idle"
      ) {
        await host.confirmDraft();
      }
    },
    forceReset: () => quarantineAndForceReset(),

    captureStarted: (session, microphone) => {
      recorder.captureStarted(session, microphone);
      if (shell.getSnapshot().sessionId === session && microphone.name) {
        shell.updateMetadata({ microphone: microphone.name });
      }
    },
    captureStartFailed: (session, failure) => {
      failureDetails.set(session, { uiMessage: failure.message });
      recorder.captureStartFailed(
        session,
        ErrorCodes.MICROPHONE_CAPTURE_FAILED,
      );
    },
    handleAudioChunk: (session, chunk, isFinalChunk) =>
      recorder.handleAudioChunk(session, chunk, isFinalChunk),

    getSnapshot: () => shell.getSnapshot(),
    onSnapshot: (listener) => shell.onSnapshot(listener),
    onNotification: (listener) => {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },

    getPendingDraft: () => host.getPendingDraft(),
    confirmDraft: () => host.confirmDraft(),
    dismissDraft: () => host.dismissDraft(),
    onDraftChanged: (listener) => host.onDraftChanged(listener),
    pasteLatestTranscription: () => host.pasteLatestTranscription(),

    dispose: () => {
      unsubscribeSnapshots();
      clearReminder();
      clearWedgeWatchdog();
      quarantineAndForceReset();
    },
  };
}
