import { ipcMain, app } from "electron";
import { EventEmitter } from "node:events";
import { Mutex } from "async-mutex";
import { logger, logPerformance } from "../logger";
import type { ServiceManager } from "@/main/managers/service-manager";
import type { RecordingState } from "../../types/recording";
import type { ShortcutManager } from "./shortcut-manager";
import { StreamingWavWriter } from "../../utils/streaming-wav-writer";
import { AppError, ErrorCodes, type ErrorCode } from "../../types/error";
import { getLatestTranscription } from "../../db/transcriptions";
import {
  RecordingMachineInterpreter,
  RECORDING_STOP_RECOVERY_TIMEOUT,
} from "./recording-machine-interpreter";
import type {
  ActiveRecordingMode,
  RecordingMachineEvent,
  RecordingMode,
  TerminationCode,
} from "./recording-state-machine";
import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuid } from "uuid";
import type { GetAccessibilityContextResult } from "@amical/types";

export type { RecordingMode } from "./recording-state-machine";

// Timing thresholds (ms)
const QUICK_PRESS_THRESHOLD = 500;
const NO_AUDIO_TIMEOUT = 5000;
const CLEANUP_STOPPING_WAIT_TIMEOUT = 1000;
// Hard bound on the stop-path draft selection capture, so a wedged helper
// can't hold the widget in "stopping". The capture is bounded tighter on its
// own (2s RPC timeout + a fast merge), so losing this race is a backstop
// case, not an expected path.
const DRAFT_CAPTURE_BARRIER_TIMEOUT = 2500;

// Recording duration limits (ms)
const RECORDING_WARNING_TIMEOUT = 5 * 60 * 1000; // 5 minutes - show warning toast
const RECORDING_MAX_DURATION = 6 * 60 * 1000; // 6 minutes - auto-stop

/**
 * Manages recording state and coordinates audio recording across the application
 * Acts as the single source of truth for recording status
 *
 * The pure FSM state lives in RecordingMachineInterpreter; this manager owns the
 * side effects and session resources around it.
 *
 * Public state is derived from the recording FSM. STARTING is a real transient
 * FSM tag, so getState() agrees with state-changed subscribers.
 *
 * Key design decisions:
 * - Mutex serializes native lifecycle work started by FSM commands
 * - Audio chunks accumulated in memory, file written only at the end
 * - Stop intent is applied before public stopping notifications so final chunks
 *   finalize with the correct action
 */
export class RecordingManager extends EventEmitter {
  // Core state
  private readonly machine: RecordingMachineInterpreter;

  // Lifecycle mutex - serializes doStart and performEndRecording
  private lifecycleMutex = new Mutex();

  // Timing
  private recordingInitiatedAt: number | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;
  private noAudioTimer: NodeJS.Timeout | null = null;
  private stuckStateTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private maxDurationTimer: NodeJS.Timeout | null = null;

  // Session state
  private currentSessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private forceIdlePromise: Promise<void> | null = null;

  // In-memory audio buffer - written to file only in handleFinalChunk
  private audioChunks: Float32Array[] = [];

  // Termination code - set during stopping to determine final action
  // null = normal (transcribe + paste), quick_release/no_audio/interrupted_start = discard
  private terminationCode: TerminationCode | null = null;

  // Performance tracking
  private recordingStartedAt: number | null = null;
  private recordingStoppedAt: number | null = null;

  // System audio state tracking
  private systemAudioMuted: boolean = false;
  // Sound muting for current session
  private soundsMuted: boolean = false;

  // Microphone name resolved from the renderer capture stream for the current session.
  private activeMicrophoneName: string | null = null;

  // Instruct mode: set when the session was started via the instruct hotkey
  // (wired in M2). Causes the cloud stream to send the "instruct" preset and
  // (in M3) the generated result to be held for review instead of auto-pasted.
  // Reset per session; stays false until the hotkey lands.
  private currentIsInstruct: boolean = false;

  // Generated draft text awaiting the user's insert/dismiss. Decoupled from the
  // recording session: finalize resets the FSM to idle as normal, and this holds
  // the result independently until confirmDraft/dismissDraft (or a new dictation)
  // resolves it. Changes are broadcast via the "draft-changed" event.
  private pendingDraft: { sessionId: string; text: string } | null = null;

  // Last Enter-mask armed value pushed to the shortcut manager / native helper.
  // The mask is armed only while a draft is ready to review (pendingDraft + idle);
  // tracked so syncDraftEnterMask only emits on actual changes.
  private draftEnterArmed = false;

  // Held so audio-chunk handling can read the live draft-binding state.
  private shortcutManager: ShortcutManager | null = null;

  constructor(private serviceManager: ServiceManager) {
    super();
    this.machine = new RecordingMachineInterpreter({
      getSessionId: () => this.currentSessionId,
      emitStateChange: (newState, oldState) =>
        this.emitStateChange(newState, oldState),
      emitModeChange: (newMode, oldMode) =>
        this.emitModeChange(newMode, oldMode),
      setStopIntent: (code, stoppedAt) => {
        this.terminationCode = code;
        this.recordingStoppedAt = stoppedAt;
      },
      logInvariant: (message, metadata) =>
        this.logRecordingInvariant(message, metadata),
      notifyMissingSpeechModel: () => this.notifyMissingSpeechModel(),
      startQuickReleaseTimer: () => this.startQuickReleaseTimer(),
      clearQuickReleaseTimer: () => this.clearQuickReleaseTimer(),
      markFirstAudioReceived: () => this.markFirstAudioReceived(),
      notifyNoAudio: () => this.notifyNoAudio(),
      notifyDurationWarning: () => this.notifyDurationWarning(),
      notifyRecordingAutoStopped: () => this.notifyRecordingAutoStopped(),
      abortFinalization: () => this.abortCurrentFinalization(),
      startSession: (mode) => this.performStartSession(mode),
      stopSession: (code) => this.performEndRecording(code),
    });
    this.setupIPCHandlers();
  }

  // Setup listeners for shortcut events
  public setupShortcutListeners(shortcutManager: ShortcutManager) {
    this.shortcutManager = shortcutManager;
    let lastPTTState = false;

    // Handle PTT state changes
    shortcutManager.on("ptt-state-changed", async (isPressed: boolean) => {
      // Only act on state changes
      if (isPressed !== lastPTTState) {
        lastPTTState = isPressed;

        if (isPressed) {
          await this.onPTTPress();
        } else {
          await this.onPTTRelease();
        }
      }
    });

    // Handle toggle recording
    shortcutManager.on("toggle-recording-triggered", async () => {
      await this.toggleHandsFree();
    });

    // Handle paste last transcription shortcut
    shortcutManager.on("paste-last-transcript-triggered", async () => {
      await this.pasteLatestTranscription();
    });

    // Handle ESC dismiss (emitted on any ESC key-down; no-op unless a session
    // is active). dismissCurrentSession guards on state.
    shortcutManager.on("escape-pressed", async () => {
      // ESC closes a pending draft review (no paste); otherwise it dismisses an
      // in-progress recording.
      if (this.pendingDraft) {
        this.dismissDraft();
        return;
      }
      await this.dismissCurrentSession();
    });

    // Enter confirms (Insert) a draft that's ready to review. The emit is gated
    // by ShortcutManager.draftActive (armed only in idle+pendingDraft), and we
    // re-check here: during the (re-)dictation that produces a draft we're not
    // idle, so Enter must not insert the about-to-be-replaced text.
    shortcutManager.on("enter-pressed", async () => {
      if (this.pendingDraft && this.getState() === "idle") {
        await this.confirmDraft();
      }
    });
  }

  /**
   * Latch the draft tag once the draft binding is seen during a session. Draft
   * is just a second PTT binding (see shortcut-manager). Reading the live draft
   * state here makes the Fn+Ctrl chord tag as draft regardless of key order; if
   * the cloud stream is already open, the transcription service pushes an
   * updated skills snapshot before the next chunk is processed.
   */
  private async latchDraftTag(): Promise<void> {
    if (!this.currentIsInstruct && this.shortcutManager?.isPTTDraftActive()) {
      this.currentIsInstruct = true;
      // Latching happens on the first audio chunk — an internal FSM transition
      // (no_audio_yet -> has_audio) with no public state change, so no
      // "state-changed" fires. Emit so the widget FAB picks up isDraft=true
      // *during* recording, not only when it later transitions to stopping.
      this.emit("draft-latched");
      if (this.currentSessionId) {
        try {
          const transcriptionService = this.serviceManager.getService(
            "transcriptionService",
          );
          await transcriptionService.updateStreamingSession({
            sessionId: this.currentSessionId,
            isInstruct: this.currentIsInstruct,
          });
        } catch (error) {
          logger.audio.warn("Failed to propagate draft latch", { error });
        }
      }
    }
  }

  private emitStateChange(
    newState: RecordingState,
    oldState: RecordingState,
  ): void {
    logger.audio.info("Recording state changed", {
      oldState,
      newState,
      sessionId: this.currentSessionId,
    });

    // Broadcast the already-derived next public state. Do not re-read here:
    // listeners should receive the exact boundary that changed.
    this.emit("state-changed", newState);
    // Re-evaluate the Enter->Insert arming: it's only valid in idle+pendingDraft,
    // so leaving idle disarms it and returning to idle (with a draft) re-arms it.
    this.syncDraftEnterMask();
  }

  private emitModeChange(newMode: RecordingMode, oldMode: RecordingMode): void {
    logger.audio.info("Recording mode changed", {
      oldMode,
      newMode,
    });

    // Broadcast mode change to all windows
    this.emit("mode-changed", newMode);
  }

  public getState(): RecordingState {
    return this.machine.getPublicState();
  }

  public getRecordingMode(): RecordingMode {
    return this.machine.getPublicMode();
  }

  /** True while the active session is a draft (instruct) session. Used by the
   *  widget FAB to show a distinct indicator during dictation + processing. */
  public getIsDraftSession(): boolean {
    return this.currentIsInstruct;
  }

  public setActiveMicrophoneForCurrentSession(input: {
    microphoneName?: string;
    deviceId?: string;
    captureSource?: "preferred" | "default";
  }): void {
    const state = this.getState();
    if (
      !this.currentSessionId ||
      (state !== "starting" && state !== "recording")
    ) {
      logger.audio.debug("Ignoring active microphone update", {
        state,
        hasSession: Boolean(this.currentSessionId),
      });
      return;
    }

    const microphoneName = input.microphoneName?.trim() || null;

    this.activeMicrophoneName = microphoneName;

    logger.audio.info("Active microphone resolved for recording session", {
      sessionId: this.currentSessionId,
      microphoneName,
      deviceId: input.deviceId?.trim() || null,
      captureSource: input.captureSource ?? null,
    });
  }

  private getActiveMicrophoneNotificationParams():
    | Record<string, string>
    | undefined {
    if (!this.activeMicrophoneName) {
      return undefined;
    }

    return { microphone: this.activeMicrophoneName };
  }

  private finalizeWithoutFinalChunk(
    code: TerminationCode,
    sessionId: string,
  ): void {
    logger.audio.info("Recording cancelled before audio capture started", {
      code,
      chunksDiscarded: this.audioChunks.length,
    });
    this.emit("recording-cancelled", { sessionId, code });
    this.resetSessionState();
  }

  private logRecordingInvariant(
    message: string,
    metadata: Record<string, unknown>,
  ): void {
    logger.audio.error(message, { invariant: true, ...metadata });
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  // PTT key pressed. (During onboarding the shortcut source gate drops these
  // events entirely — see ShortcutManager.setCommandsSuppressed — so no
  // onboarding awareness is needed here.)
  public async onPTTPress() {
    if (this.getState() === "idle") {
      this.recordingInitiatedAt = Date.now();
      await this.doStart("ptt");
      return;
    }

    await this.machine.handleEvent({
      type: "pttPress",
      quick: this.isQuickAction(),
    });
  }

  // PTT key released
  public async onPTTRelease() {
    await this.machine.handleEvent({
      type: "pttRelease",
      quick: this.isQuickAction(),
    });
  }

  // Toggle shortcut pressed
  public async toggleHandsFree() {
    // Draft mode is push-to-talk only and is exited only by Insert/dismiss, so
    // the hands-free toggle does nothing while a draft review is pending.
    if (this.pendingDraft) {
      return;
    }

    if (this.getState() === "idle") {
      this.recordingInitiatedAt = Date.now();
      await this.doStart("hands-free");
      return;
    }

    // Draft is push-to-talk only: don't let the hands-free toggle upgrade an
    // active draft session (it would otherwise become a "hands-free draft").
    if (this.currentIsInstruct) {
      return;
    }

    await this.machine.handleEvent({
      type: "toggle",
      quick: this.isQuickAction(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start recording with mutex protection
   */
  private async doStart(mode: ActiveRecordingMode) {
    await this.lifecycleMutex.runExclusive(async () => {
      if (this.getState() !== "idle") {
        logger.audio.warn("Cannot start recording - not idle", {
          currentState: this.getState(),
        });
        this.recordingInitiatedAt = null;
        return;
      }

      // Draft mode is sticky: starting a dictation while a draft review is
      // pending makes the new session itself a draft (only Insert/dismiss exits
      // draft mode). The pending draft stays VISIBLE during this replacement
      // dictation — the review window shows a "listening…/drafting…" status and
      // swaps to the fresh result when this session finalizes. The Enter->Insert
      // mask auto-disarms while we're not idle (syncDraftEnterMask), so Enter
      // can't insert the about-to-be-replaced text mid-dictation.
      const supersedingDraft = this.pendingDraft !== null;

      const hasSpeechModel = await this.hasSpeechModelSelected();
      if (hasSpeechModel) {
        // Missing-model starts stay IDLE; STARTING means we have a model and
        // have allocated the session identity used by the interpreter.
        this.currentSessionId = uuid();
        this.activeMicrophoneName = null;
        // Tag this as a draft session up front (the draft chord is held now) so
        // the recording/processing FAB can show the draft indicator immediately,
        // not only once latchDraftTag fires on the first audio chunk. Sticky
        // supersede (dictating over a pending draft) also counts.
        if (supersedingDraft || this.shortcutManager?.isPTTDraftActive()) {
          this.currentIsInstruct = true;
        }
      }

      const commands = this.machine.transition({
        type: "start",
        mode,
        hasSpeechModel,
      });

      if (!hasSpeechModel) {
        this.recordingInitiatedAt = null;
      }

      await this.machine.runCommands(commands);
    });
  }

  private async performStartSession(mode: ActiveRecordingMode): Promise<void> {
    const startTime = performance.now();
    logger.audio.info("RecordingManager: performStartSession called", { mode });
    const stateAtStart = this.machine.currentState;

    if (
      stateAtStart.tag !== "STARTING" &&
      !this.machine.isStoppingState(stateAtStart)
    ) {
      this.logRecordingInvariant(
        "Recording start session command received outside STARTING",
        {
          mode,
          machineState: this.machine.describeState(stateAtStart),
        },
      );
      return;
    }

    // doStart allocates the session ID before emitting startSession; if absent,
    // the renderer/transcription session identity cannot be kept consistent.
    if (!this.currentSessionId) {
      this.logRecordingInvariant(
        "Recording start reached interpreter without a session ID",
        {
          mode,
          machineState: this.machine.describeCurrentState(),
        },
      );
      this.resetSessionState({ force: true });
      return;
    }

    if (stateAtStart.tag !== "STARTING") {
      // A synchronous state-changed listener requested stop while handling
      // STARTING. Complete native start so the queued stop command can tear
      // down a real native session. Native start/stop must tolerate this
      // immediate handshake during interrupted starts.
      logger.audio.info("Recording stop requested before start session ready", {
        mode,
        machineState: this.machine.describeState(stateAtStart),
      });

      this.audioChunks = [];
      this.initPromise = this.initializeSession();
      await this.initPromise;
      this.initPromise = null;

      const totalDuration = performance.now() - startTime;
      logger.audio.info("Recording session initialized after stop requested", {
        sessionId: this.currentSessionId,
        duration: `${totalDuration.toFixed(2)}ms`,
        machineState: this.machine.describeCurrentState(),
      });
      return;
    }

    const sessionStartTime = performance.now();
    this.terminationCode = null;
    this.recordingStartedAt = sessionStartTime;
    this.recordingStoppedAt = null;
    this.audioChunks = [];

    this.machine.runSyncCommands(
      this.machine.handleSyncEvent({ type: "startSessionReady" }),
    );

    this.startNoAudioTimer();
    this.startDurationTimers();

    // Async init inside mutex
    this.initPromise = this.initializeSession();
    await this.initPromise;
    this.initPromise = null;

    const totalDuration = performance.now() - startTime;
    logger.audio.info("Recording started", {
      sessionId: this.currentSessionId,
      duration: `${totalDuration.toFixed(2)}ms`,
    });
  }

  /**
   * Initialize session asynchronously
   * No file operations here - chunks accumulate in memory
   */
  private async initializeSession(): Promise<void> {
    try {
      // Reset VAD state for fresh speech detection (mutex-protected to avoid
      // interleaving with retry VAD computation)
      const transcriptionService = this.serviceManager.getService(
        "transcriptionService",
      );
      await transcriptionService.resetVadForNewSession();

      // Warm the active provider in parallel with native startRecording so
      // first-chunk latency doesn't include token refresh (cloud) or model
      // load (whisper, if not preloaded). Errors are non-fatal — the actual
      // transcribe() call still has its own auth/load paths.
      void transcriptionService.warmupActiveProvider().catch((error) => {
        logger.audio.warn("Provider warmup failed (non-fatal)", { error });
      });

      // Refresh accessibility context (TextMarker API for Electron support).
      // Fire and forget: if it resolves before the first chunk, the
      // transcription service stores it for stream-open; otherwise it pushes a
      // live gRPC session update.
      const nativeBridge = this.serviceManager.getService("nativeBridge");
      const sessionId = this.currentSessionId;
      void nativeBridge
        .refreshAccessibilityContext()
        .then(async () => {
          const accessibilityContext = nativeBridge.getAccessibilityContext();
          // Null means the refresh failed or the helper could not resolve a
          // usable focused-app/text context. The gRPC client currently only
          // sends concrete context snapshots, so clearing a previously sent
          // context is intentionally left unsupported here.
          if (
            !sessionId ||
            !accessibilityContext ||
            this.currentSessionId !== sessionId
          ) {
            return;
          }

          await transcriptionService.updateStreamingSession({
            sessionId,
            accessibilityContext,
          });
        })
        .catch((error) => {
          logger.audio.warn("Failed to propagate accessibility context", {
            error,
          });
        });

      // Always call startRecording, conditionally mute system audio and play sounds
      const settingsService = this.serviceManager.getService("settingsService");
      const preferences = await settingsService.getPreferences();
      const shouldMute = preferences.muteSystemAudio;
      this.soundsMuted = preferences.muteDictationSounds;

      const result = await nativeBridge.call("startRecording", {
        muteSystemAudio: shouldMute,
        muteSounds: this.soundsMuted,
      });
      this.systemAudioMuted = shouldMute && !!result?.success;
    } catch (error) {
      this.systemAudioMuted = false;
      logger.audio.error("Failed to initialize session", { error });
    }
  }

  /**
   * Draft-mode fallback: when the accessibility context couldn't read the
   * selected text — null, or a phantom "" such as Chrome page selections where
   * the WebArea reports a {0,0} range — capture it via the helper's
   * clipboard-copy RPC and merge it into the streaming session context.
   *
   * Runs inline in performEndRecording (stop time), once, for non-cancelled
   * draft stops only — so the session is alive by construction, cancels never
   * reach it, and the chord keys are already released when the copy chord is
   * injected (the helper's modifier masking is defense-in-depth). Costs
   * ~50-150ms at stop when a selection exists, the full poll timeout (~300ms)
   * when nothing is selected; the RPC's own 2s timeout bounds the worst case,
   * with the caller's race (DRAFT_CAPTURE_BARRIER_TIMEOUT) as backstop.
   * Never runs for plain dictation.
   */
  private async captureDraftSelectionViaCopy(sessionId: string): Promise<void> {
    try {
      // Session already torn down — nothing to capture for.
      if (this.currentSessionId !== sessionId) {
        return;
      }

      const nativeBridge = this.serviceManager.getService("nativeBridge");
      const cached = nativeBridge.getAccessibilityContext();
      const axSelectedText = cached?.context?.textSelection?.selectedText;
      if (axSelectedText && axSelectedText.trim() !== "") {
        return; // AX path already captured the selection
      }

      const baseContext = cached?.context;
      if (!baseContext) {
        // The bridge clears its cache when a refresh starts, so it holds this
        // session's result or null: null means the refresh failed, hasn't
        // resolved yet, or the helper produced no usable context — either way
        // there is nothing trustworthy to merge into, so skip before paying
        // for an injection we couldn't use.
        logger.audio.warn(
          "Draft copy-capture skipped: no fresh accessibility context to merge into",
          { sessionId },
        );
        return;
      }

      const captured = await nativeBridge.getSelectedTextViaCopy();
      const selectedText = captured?.selectedText;
      if (!selectedText || selectedText.trim() === "") {
        logger.audio.info("Draft copy-capture found no selection", {
          sessionId,
          clipboardChanged: captured?.clipboardChanged ?? null,
          message: captured?.message,
        });
        return;
      }

      // Session ended while the capture was in flight — don't merge into a
      // session that moved on without us.
      if (this.currentSessionId !== sessionId) {
        return;
      }

      // clipboardCopy yields only the text. Every other selection field is
      // either unknown or known-wrong — this path only runs because the AX
      // read failed or returned a phantom range, so the base context's
      // window fields (fullContent, pre/post text) describe the wrong
      // location. Report null/false rather than junk; isEditable false so
      // downstream never plans an in-place replacement it can't verify.
      const merged: GetAccessibilityContextResult = {
        context: {
          ...baseContext,
          textSelection: {
            selectedText,
            fullContent: null,
            preSelectionText: null,
            postSelectionText: null,
            selectionRange: null,
            isEditable: false,
            extractionMethod: "clipboardCopy",
            hasMultipleRanges: false,
            isPlaceholder: false,
            isSecure: baseContext.textSelection?.isSecure ?? false,
            fullContentTruncated: false,
          },
        },
      };

      const transcriptionService = this.serviceManager.getService(
        "transcriptionService",
      );
      await transcriptionService.updateStreamingSession({
        sessionId,
        accessibilityContext: merged,
      });

      logger.audio.info("Draft selection captured via clipboard copy", {
        sessionId,
        selectedTextLength: selectedText.length,
      });
    } catch (error) {
      logger.audio.warn("Draft copy-capture fallback failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * End recording - unified method for stop and cancel
   * @param code - null for normal stop, or cancellation code
   */
  private async performEndRecording(
    code: TerminationCode | null = null,
  ): Promise<void> {
    // transition() creates this synchronously before the stopSession command is
    // dispatched, so final chunks can wait for the native stop command below.
    // If a later stop replaces it before the mutex runs, resolving this stale
    // handle is intentionally idempotent in the interpreter.
    const pendingStopSession = this.machine.currentPendingStopSession;
    if (!pendingStopSession) {
      this.logRecordingInvariant(
        "Recording stop command reached interpreter without a pending stop session",
        {
          code,
          machineState: this.machine.describeCurrentState(),
        },
      );
    }

    await this.lifecycleMutex.runExclusive(async () => {
      try {
        const stopState = this.machine.currentState;
        if (!this.machine.isStoppingState(stopState)) {
          this.logRecordingInvariant(
            "Cannot end recording - FSM is not stopping",
            {
              machineState: this.machine.describeState(stopState),
              recordingState: this.getState(),
              code,
            },
          );
          return;
        }

        const effectiveCode = this.machine.effectiveStopCodeForState(
          stopState,
          code,
        );
        const shouldCancelStreamingEarly = effectiveCode !== null;

        // Wait for init to complete
        if (this.initPromise) {
          await this.initPromise;
          this.initPromise = null;
        }

        const sessionId = this.currentSessionId;

        logger.audio.info("Ending recording", {
          sessionId,
          code: effectiveCode,
        });

        // Reinforce the synchronous stop intent before any final chunk can
        // finalize; this may already be set by prepareStopSessionIntent.
        this.terminationCode = effectiveCode;

        // The FSM has already entered STOP_*. This native stop asks the worklet
        // to send the final chunk that drives finalization back to IDLE.
        this.clearTimers();
        this.recordingInitiatedAt = null;

        // Always call stopRecording, conditionally restore system audio and play sounds
        try {
          const nativeBridge = this.serviceManager.getService("nativeBridge");
          await nativeBridge.call("stopRecording", {
            wasMuted: this.systemAudioMuted,
            muteSounds: this.soundsMuted,
          });
          this.systemAudioMuted = false;
        } catch (error) {
          this.systemAudioMuted = false;
          logger.main.warn("Failed to stop recording via native bridge", {
            error,
          });
        }

        // Cancel streaming immediately for true cancellations.
        if (shouldCancelStreamingEarly && sessionId) {
          try {
            const transcriptionService = this.serviceManager.getService(
              "transcriptionService",
            );
            await transcriptionService.cancelStreamingSession(sessionId);
          } catch (error) {
            logger.audio.warn("Failed to cancel streaming session", { error });
          }
        }

        if (this.machine.shouldFinalizeWithoutFinalChunk(stopState)) {
          if (!sessionId) {
            this.logRecordingInvariant(
              "Cannot finalize interrupted start without a session ID",
              {
                machineState: this.machine.describeState(stopState),
                code: effectiveCode,
              },
            );
            await this.forceIdle();
            return;
          }

          this.machine.resolvePendingStopSession(pendingStopSession);
          this.finalizeWithoutFinalChunk("interrupted_start", sessionId);
          return;
        }

        // Draft selection capture, inline at stop. Placed AFTER the native
        // stop so the rec-stop sound and unmute aren't blocked; ordering is
        // still safe because the final chunk's finalize waits on
        // pendingStopSession, which only resolves in the finally below.
        if (!shouldCancelStreamingEarly && this.currentIsInstruct && sessionId) {
          await Promise.race([
            this.captureDraftSelectionViaCopy(sessionId),
            new Promise<void>((resolve) =>
              setTimeout(resolve, DRAFT_CAPTURE_BARRIER_TIMEOUT),
            ),
          ]);
        }

        // Safety timeout for stuck state
        this.stuckStateTimer = setTimeout(() => {
          if (this.getState() === "stopping") {
            logger.audio.warn("No final chunk received, forcing idle");
            void this.forceIdle().catch((error) => {
              logger.audio.error(
                "Failed to force idle from stuck state timer",
                {
                  error,
                  machineState: this.machine.describeCurrentState(),
                },
              );
            });
          }
        }, RECORDING_STOP_RECOVERY_TIMEOUT);
      } finally {
        this.machine.resolvePendingStopSession(pendingStopSession);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHUNK PROCESSING
  // ═══════════════════════════════════════════════════════════════════

  private async handleAudioChunk(
    chunk: Float32Array,
    isFinalChunk: boolean,
  ): Promise<void> {
    const recordingState = this.getState();

    // Only process if recording or stopping
    if (recordingState !== "recording" && recordingState !== "stopping") {
      logger.audio.debug("Discarding audio chunk - not in active state", {
        state: recordingState,
        isFinalChunk,
      });
      return;
    }

    // Wait for async init to complete. A chunk that finds init still pending was
    // captured during native start — which only resolves after the start sound
    // finishes playing and system audio is muted — i.e. while the start beep was
    // audible to the microphone.
    const capturedDuringStartSound = this.initPromise !== null;
    if (this.initPromise) {
      await this.initPromise;
    }

    const stateAfterInit = this.getState();
    if (stateAfterInit !== "recording" && stateAfterInit !== "stopping") {
      logger.audio.debug("Discarding audio chunk - inactive after init", {
        state: stateAfterInit,
        isFinalChunk,
      });
      return;
    }

    // Drop frames captured during the start-sound window so the dictation beep
    // isn't recorded. Capture is already live (no added start latency); only the
    // beep-window frames are discarded. Skipped when sounds are muted (no beep,
    // so that audio is real speech worth keeping) and for the final chunk (so a
    // recording that stops mid-beep still finalizes).
    if (capturedDuringStartSound && !this.soundsMuted && !isFinalChunk) {
      logger.audio.debug("Dropping start-sound-window chunk");
      return;
    }

    // Hot path: every chunk hits this. Only enter the FSM when the audioChunk
    // event could actually transition state (first audio chunk into a recording
    // state). Subsequent chunks would be a self-transition that just allocates.
    if (this.machine.shouldTransitionOnAudioChunk(chunk.length > 0)) {
      await this.machine.handleEvent({ type: "audioChunk", hasAudio: true });
    }

    // Handle final chunk
    if (isFinalChunk) {
      // Add final chunk to buffer before processing (it may contain audio data)
      if (chunk.length > 0) {
        this.audioChunks.push(chunk);

        // Also send to transcription if we have a session and not terminated
        if (this.currentSessionId && !this.terminationCode) {
          try {
            const transcriptionService = this.serviceManager.getService(
              "transcriptionService",
            );
            await this.latchDraftTag();
            await transcriptionService.processStreamingChunk({
              sessionId: this.currentSessionId,
              audioChunk: chunk,
              recordingStartedAt: this.recordingStartedAt || undefined,
              isInstruct: this.currentIsInstruct,
            });
          } catch (error) {
            logger.audio.error("Error processing final chunk:", error);
          }
        }
      }
      await this.handleFinalChunk();
      return;
    }

    // Only accumulate during recording (not stopping)
    if (this.getState() !== "recording") {
      return;
    }

    const sessionId = this.currentSessionId;
    if (!sessionId || chunk.length === 0) {
      return;
    }

    // Accumulate in memory
    this.audioChunks.push(chunk);

    // Stream to transcription (skip if terminated)
    if (!this.terminationCode) {
      try {
        const transcriptionService = this.serviceManager.getService(
          "transcriptionService",
        );
        await this.latchDraftTag();
        await transcriptionService.processStreamingChunk({
          sessionId,
          audioChunk: chunk,
          recordingStartedAt: this.recordingStartedAt || undefined,
          isInstruct: this.currentIsInstruct,
        });
      } catch (error) {
        logger.audio.error("Error processing chunk:", error);
      }
    }
  }

  /**
   * Handle the final chunk - unified termination logic
   */
  private async handleFinalChunk(): Promise<void> {
    // Clear stuck state timer
    if (this.stuckStateTimer) {
      clearTimeout(this.stuckStateTimer);
      this.stuckStateTimer = null;
    }

    if (this.getState() !== "stopping") {
      logger.audio.debug("Unexpected state in handleFinalChunk", {
        state: this.getState(),
      });
      return;
    }

    const pendingStopResult = await this.machine.waitForPendingStopSession();
    if (pendingStopResult === "timeout") {
      await this.forceIdle();
      return;
    }

    if (this.getState() !== "stopping") {
      // Interrupted-start can finalize synchronously in performEndRecording
      // while a renderer final chunk is waiting on the pending stop command.
      logger.audio.debug("Recording finalized while waiting for stop command", {
        state: this.getState(),
      });
      return;
    }

    const sessionId = this.currentSessionId || "";
    const chunks = this.audioChunks;
    const code = this.terminationCode;

    // Discard codes (quick_release, no_audio, interrupted_start) drop the buffer.
    // user_dismissed is NOT a discard — it keeps the audio, like a normal stop.
    if (code && code !== "user_dismissed") {
      logger.audio.info("Recording cancelled", {
        code,
        chunksDiscarded: chunks.length,
      });
      this.emit("recording-cancelled", { sessionId, code });
      this.resetSessionState();
      return;
    }

    // Normal + dismissed both persist the captured audio — written once, here.
    const audioFilePath = await this.writeAudioFile(sessionId, chunks);
    this.audioChunks = [];

    if (code === "user_dismissed") {
      logger.audio.info("Recording dismissed", {
        sessionId,
        hasAudio: !!audioFilePath,
      });
      try {
        await this.serviceManager
          .getService("transcriptionService")
          .saveDismissedTranscription({
            sessionId,
            audioFilePath: audioFilePath || undefined,
          });
      } catch (error) {
        logger.audio.error("Failed to save dismissed transcription", {
          error,
        });
      }
      this.emit("recording-cancelled", { sessionId, code });
      this.resetSessionState();
      return;
    }

    // NORMAL - get transcription and paste
    let result = "";
    try {
      const transcriptionService = this.serviceManager.getService(
        "transcriptionService",
      );
      result = await transcriptionService.finalizeSession({
        sessionId,
        audioFilePath: audioFilePath || undefined,
        recordingStartedAt: this.recordingStartedAt || undefined,
        recordingStoppedAt: this.recordingStoppedAt || undefined,
      });
    } catch (error) {
      // User dismissed during finalize — TranscriptionService already persisted
      // the dismissed row; reset silently (no failure / no-speech notification).
      if (
        error instanceof AppError &&
        error.errorCode === ErrorCodes.USER_DISMISSED
      ) {
        logger.audio.info("Recording dismissed during finalize", { sessionId });
        this.resetSessionState();
        return;
      }

      logger.audio.error("Failed to get final transcription", { error });

      // Extract error properties for notification (DB write handled by TranscriptionService)
      let errorCode: ErrorCode = ErrorCodes.UNKNOWN;
      let uiTitle: string | undefined;
      let uiMessage: string | undefined;
      let traceId: string | undefined;

      if (error instanceof AppError) {
        errorCode = error.errorCode;
        uiTitle = error.uiTitle;
        uiMessage = error.uiMessage;
        traceId = error.traceId;
      }

      // Notify user with error code and optional UI overrides
      this.emit("widget-notification", {
        type: "transcription_failed",
        errorCode,
        uiTitle,
        uiMessage,
        traceId,
      });
      logger.audio.info("Emitted widget notification", {
        type: "transcription_failed",
        errorCode,
        hasUiTitle: !!uiTitle,
        hasUiMessage: !!uiMessage,
        hasTraceId: !!traceId,
      });

      this.resetSessionState();
      return;
    }

    logPerformance("streaming transcription complete", Date.now(), {
      sessionId,
      resultLength: result?.length || 0,
    });

    // A non-empty result means finalizeSession committed (its final dismiss gate
    // passed before the DB write). We deliberately do NOT re-check the dismiss
    // flag here: a dismiss landing in this single-ms tail is an accepted race —
    // the transcript is already saved, and pasteTranscription hands off to the
    // native helper, so by the time the paste fires it is too late to abort.
    if (result) {
      if (this.currentIsInstruct) {
        // Draft: hold the generated text for review instead of auto-pasting. The
        // result lives in pendingDraft, independent of the recording session, so
        // the FSM resets to idle as normal below and a new dictation can start
        // immediately. Resolved by confirmDraft / dismissDraft / a new session.
        this.setPendingDraft({ sessionId, text: result });
        logger.audio.info("Draft result ready for review", {
          sessionId,
          textLength: result.length,
        });
        this.resetSessionState();
        return;
      }
      await this.pasteTranscription(result);
    } else {
      // Check for empty transcript notification
      const sessionDurationMs =
        this.recordingStoppedAt && this.recordingStartedAt
          ? this.recordingStoppedAt - this.recordingStartedAt
          : 0;
      if (sessionDurationMs > 3500) {
        this.emit("widget-notification", {
          type: "empty_transcript",
          params: this.getActiveMicrophoneNotificationParams(),
        });
        logger.audio.info("Emitted widget notification", {
          type: "empty_transcript",
          microphoneName: this.activeMicrophoneName,
        });
      }
    }

    this.resetSessionState();
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════

  private isQuickAction(): boolean {
    if (!this.recordingInitiatedAt) return false;
    return Date.now() - this.recordingInitiatedAt < QUICK_PRESS_THRESHOLD;
  }

  private async hasSpeechModelSelected(): Promise<boolean> {
    const modelService = this.serviceManager.getService("modelService");
    return Boolean(await modelService.getSelectedModel());
  }

  private notifyMissingSpeechModel(): void {
    logger.audio.warn("Cannot start recording - no speech model selected");
    this.emit("widget-notification", {
      type: "transcription_failed",
      errorCode: ErrorCodes.MODEL_MISSING,
    });
    logger.audio.info("Emitted widget notification", {
      type: "transcription_failed",
      errorCode: ErrorCodes.MODEL_MISSING,
      reason: "no_speech_model_selected",
    });
  }

  private startQuickReleaseTimer(): void {
    this.cancelTimer = setTimeout(() => {
      this.cancelTimer = null;
      logger.audio.info("Quick release timeout, cancelling");
      this.handleTimerMachineEvent(
        { type: "quickReleaseTimeout" },
        "quick-release timeout",
      );
    }, QUICK_PRESS_THRESHOLD);
  }

  private clearQuickReleaseTimer(): void {
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
    }
  }

  private markFirstAudioReceived(): void {
    this.clearNoAudioTimer();
    logger.audio.info("First audio chunk received", {
      sessionId: this.currentSessionId,
    });
  }

  private notifyNoAudio(): void {
    logger.audio.warn("No audio detected for 5 seconds");
    this.emit("no-audio-detected");
    this.emit("widget-notification", {
      type: "no_audio",
      params: this.getActiveMicrophoneNotificationParams(),
    });
    logger.audio.info("Emitted widget notification", {
      type: "no_audio",
      microphoneName: this.activeMicrophoneName,
    });
  }

  private notifyDurationWarning(): void {
    const remainingMinutes = Math.round(
      (RECORDING_MAX_DURATION - RECORDING_WARNING_TIMEOUT) / 60_000,
    );

    logger.audio.warn("Recording duration warning", {
      sessionId: this.currentSessionId,
      remainingMinutes,
    });
    this.emit("widget-notification", {
      type: "recording_duration_warning",
      params: {
        minutes: remainingMinutes,
        maxMinutes: Math.round(RECORDING_MAX_DURATION / 60_000),
      },
    });
  }

  private notifyRecordingAutoStopped(): void {
    logger.audio.warn("Recording auto-stopped at max duration", {
      sessionId: this.currentSessionId,
    });
    this.emit("widget-notification", {
      type: "recording_auto_stopped",
    });
  }

  private clearTimers(): void {
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
    }
    if (this.noAudioTimer) {
      clearTimeout(this.noAudioTimer);
      this.noAudioTimer = null;
    }
    if (this.stuckStateTimer) {
      clearTimeout(this.stuckStateTimer);
      this.stuckStateTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private clearNoAudioTimer(): void {
    if (this.noAudioTimer) {
      clearTimeout(this.noAudioTimer);
      this.noAudioTimer = null;
    }
  }

  private async waitForIdleOrTimeout(timeoutMs: number): Promise<void> {
    if (this.getState() === "idle") {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.off("state-changed", onStateChanged);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onStateChanged = (state: RecordingState) => {
        if (state === "idle") {
          finish();
        }
      };

      const timeoutHandle = setTimeout(() => {
        logger.audio.info("Cleanup wait for idle timed out", {
          timeoutMs,
          state: this.getState(),
        });
        finish();
      }, timeoutMs);

      this.on("state-changed", onStateChanged);

      if (this.getState() === "idle") {
        finish();
      }
    });
  }

  private startNoAudioTimer(): void {
    this.noAudioTimer = setTimeout(() => {
      this.handleTimerMachineEvent(
        { type: "noAudioTimeout" },
        "no-audio timeout",
      );
    }, NO_AUDIO_TIMEOUT);
  }

  private startDurationTimers(): void {
    this.warningTimer = setTimeout(() => {
      this.handleTimerMachineEvent(
        { type: "durationWarningTimeout" },
        "duration warning timeout",
      );
    }, RECORDING_WARNING_TIMEOUT);

    this.maxDurationTimer = setTimeout(() => {
      this.handleTimerMachineEvent(
        { type: "maxDurationTimeout" },
        "max duration timeout",
      );
    }, RECORDING_MAX_DURATION);
  }

  private handleTimerMachineEvent(
    event: RecordingMachineEvent,
    label: string,
  ): void {
    void this.machine.handleEvent(event).catch((error) => {
      logger.audio.error("Failed to handle recording timer event", {
        error,
        label,
        event,
        machineState: this.machine.describeCurrentState(),
      });

      if (
        !this.shouldRecoverFailedTimerEvent(event) ||
        this.getState() === "idle"
      ) {
        return;
      }

      // Stop-emitting timer failures can happen before performEndRecording arms
      // its stuck-state timer, so recover directly while leaving notification
      // timers as log-only failures.
      void this.forceIdle().catch((forceIdleError) => {
        logger.audio.error("Failed to recover recording timer event", {
          error: forceIdleError,
          label,
          event,
          machineState: this.machine.describeCurrentState(),
        });
      });
    });
  }

  private shouldRecoverFailedTimerEvent(event: RecordingMachineEvent): boolean {
    return (
      event.type === "quickReleaseTimeout" ||
      event.type === "noAudioTimeout" ||
      event.type === "maxDurationTimeout"
    );
  }

  private async forceIdle(): Promise<void> {
    if (this.forceIdlePromise) {
      return this.forceIdlePromise;
    }

    this.forceIdlePromise = this.performForceIdle();
    try {
      await this.forceIdlePromise;
    } finally {
      this.forceIdlePromise = null;
    }
  }

  private async performForceIdle(): Promise<void> {
    logger.audio.warn("Forcing idle due to stuck state");

    // Cancel streaming session if one exists to prevent memory leak and audio bleed
    if (this.currentSessionId) {
      try {
        const transcriptionService = this.serviceManager.getService(
          "transcriptionService",
        );
        await transcriptionService.cancelStreamingSession(
          this.currentSessionId,
        );
      } catch (error) {
        logger.audio.warn("Failed to cancel streaming session", { error });
      }
    }

    // Always call stopRecording, conditionally restore system audio and play sounds
    try {
      const nativeBridge = this.serviceManager.getService("nativeBridge");
      await nativeBridge.call("stopRecording", {
        wasMuted: this.systemAudioMuted,
        muteSounds: this.soundsMuted,
      });
    } catch (error) {
      logger.main.warn(
        "Failed to stop recording via native bridge in forceIdle",
        {
          error,
        },
      );
    } finally {
      this.systemAudioMuted = false;
    }

    this.resetSessionState({ force: true });
  }

  private resetSessionState(options: { force?: boolean } = {}): void {
    // Clear the draft tag before the FSM reset: machine.resetSession fires the
    // state-changed("idle") emit synchronously, and the recording status reads
    // getIsDraftSession() from it — so this must be false by then to avoid a
    // stale isDraft=true on the idle update.
    this.currentIsInstruct = false;
    if (!this.machine.resetSession(options)) {
      return;
    }
    this.currentSessionId = null;
    this.initPromise = null;
    this.recordingInitiatedAt = null;
    this.audioChunks = [];
    this.terminationCode = null;
    this.systemAudioMuted = false;
    this.soundsMuted = false;
    this.activeMicrophoneName = null;
    this.clearTimers();
  }

  /**
   * Create audio file for recording session
   */
  private async createAudioFile(sessionId: string): Promise<string> {
    const audioDir = path.join(app.getPath("temp"), "amical-audio");
    await fs.promises.mkdir(audioDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(audioDir, `audio-${sessionId}-${timestamp}.wav`);

    logger.audio.info("Created audio file for session", {
      sessionId,
      filePath,
    });

    return filePath;
  }

  /**
   * Write the accumulated audio chunks to a WAV file. Returns the path, or null
   * if there were no chunks or the write failed.
   */
  private async writeAudioFile(
    sessionId: string,
    chunks: Float32Array[],
  ): Promise<string | null> {
    if (chunks.length === 0) {
      return null;
    }

    try {
      const audioFilePath = await this.createAudioFile(sessionId);
      const wavWriter = new StreamingWavWriter(audioFilePath);

      for (const chunk of chunks) {
        await wavWriter.appendAudio(chunk);
      }
      await wavWriter.finalize();

      logger.audio.info("Audio file written", {
        sessionId,
        filePath: audioFilePath,
        chunks: chunks.length,
      });
      return audioFilePath;
    } catch (error) {
      logger.audio.error("Failed to write audio file", { error });
      return null;
    }
  }

  /** The draft result awaiting insert/dismiss, or null. */
  public getPendingDraft(): { sessionId: string; text: string } | null {
    return this.pendingDraft;
  }

  /** Set/clear the pending draft and broadcast the change to subscribers. */
  private setPendingDraft(
    draft: { sessionId: string; text: string } | null,
  ): void {
    this.pendingDraft = draft;
    this.emit("draft-changed", draft);
    this.syncDraftEnterMask();
  }

  /**
   * Arm the Enter->Insert routing + native Enter mask ONLY while a draft is
   * ready to review: a pending draft AND the FSM is idle. During the
   * (re-)dictation that produces or replaces a draft we are not idle, so Enter
   * is disarmed and can never insert the about-to-be-replaced text. The native
   * mask stays one-shot (self-disarms on the Enter key-up); arming reflects
   * "is there a reviewable draft right now". Driven from setPendingDraft and
   * every state change so the two inputs (pendingDraft, state) stay in sync.
   */
  private syncDraftEnterMask(): void {
    const armed = this.pendingDraft !== null && this.getState() === "idle";
    // Called on every state change; only push when the armed value actually
    // flips (avoids redundant native RPCs on routine idle->rec->idle transitions).
    if (armed === this.draftEnterArmed) {
      return;
    }
    this.draftEnterArmed = armed;
    this.shortcutManager?.setDraftActive(armed);
    const nativeBridge = this.serviceManager.getService("nativeBridge");
    if (nativeBridge) {
      void nativeBridge.setDraftEnterCapture(armed);
    }
  }

  /** Confirm the pending draft: paste the held text. (Session is already idle.) */
  public async confirmDraft(): Promise<void> {
    const pending = this.pendingDraft;
    this.setPendingDraft(null);
    if (pending?.text) {
      await this.pasteTranscription(pending.text);
    }
  }

  /** Dismiss the pending draft without pasting. */
  public dismissDraft(): void {
    this.setPendingDraft(null);
  }

  private async pasteTranscription(transcription: string): Promise<void> {
    if (!transcription || typeof transcription !== "string") {
      logger.main.warn("Invalid transcription, not pasting");
      return;
    }

    try {
      const nativeBridge = this.serviceManager.getService("nativeBridge");
      const settingsService = this.serviceManager.getService("settingsService");
      const preferences = await settingsService.getPreferences();
      const preserveClipboard = preferences.preserveClipboard;

      logger.main.info("Pasting transcription to active application", {
        textLength: transcription.length,
        preserveClipboard,
      });

      if (nativeBridge) {
        void nativeBridge
          .call("pasteText", {
            transcript: transcription,
            preserveClipboard,
          })
          .catch((error) => {
            logger.main.warn(
              "Failed to paste transcription via native helper",
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          });
      }
    } catch (error) {
      logger.main.warn(
        "Native bridge not available, cannot paste transcription",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async pasteLatestTranscription(): Promise<void> {
    try {
      const latest = await getLatestTranscription();
      if (!latest || !latest.text?.trim()) {
        logger.main.info("No previous transcription available to paste");
        return;
      }

      await this.pasteTranscription(latest.text);
    } catch (error) {
      logger.main.warn("Failed to paste last transcription", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // IPC HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  private setupIPCHandlers(): void {
    // Handle audio data chunks from renderer
    ipcMain.handle(
      "audio-data-chunk",
      async (_event, chunk: ArrayBuffer, isFinalChunk: boolean) => {
        if (!(chunk instanceof ArrayBuffer)) {
          logger.audio.error("Received invalid audio chunk type", {
            type: typeof chunk,
          });
          throw new Error("Invalid audio chunk type received.");
        }

        // Convert ArrayBuffer back to Float32Array
        const float32Array = new Float32Array(chunk);
        logger.audio.debug("Received audio chunk", {
          samples: float32Array.length,
          isFinalChunk,
        });

        await this.handleAudioChunk(float32Array, isFinalChunk);
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API (for tRPC routers)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Signal to start recording (called from tRPC)
   */
  public async signalStart(): Promise<void> {
    if (this.getState() === "idle") {
      this.recordingInitiatedAt = Date.now();
      await this.doStart("hands-free");
    }
  }

  /**
   * Signal to stop recording (called from tRPC)
   */
  public async signalStop(): Promise<void> {
    const state = this.getState();
    if (state !== "recording" && state !== "starting") {
      return;
    }

    await this.machine.handleEvent({ type: "signalStop" });
  }

  /**
   * Dismiss the current dictation: abort transcription/paste and persist the
   * captured audio to History with reason "dismissed". Called by ESC and the
   * widget ✗ button. No-op when idle.
   */
  public async dismissCurrentSession(): Promise<void> {
    // The FSM decides what dismiss means per state: STARTING → interrupted_start,
    // REC_* → stop as user_dismissed, STOP_N (in-flight finalize) → abort the
    // transcription (abortFinalization command), idle / already-cancelling
    // STOP_C → no-op.
    await this.machine.handleEvent({ type: "dismiss" });
  }

  /**
   * Abort an in-flight finalize (FSM abortFinalization command, emitted when
   * dismiss arrives during STOP_N). One signal does both jobs: it flags
   * finalizeSession's dismiss gates AND cancels the in-flight flush (off-mutex,
   * via flush() → provider.reset()), so finalizeSession persists a dismissed row
   * instead of pasting and a slow/hung finalize returns to idle immediately
   * instead of waiting for the network call. We deliberately do NOT delete the
   * streaming session here: that would race finalizeSession and drop the audio.
   */
  private abortCurrentFinalization(): void {
    const sessionId = this.currentSessionId;
    if (!sessionId) {
      return;
    }
    // Keep the terminationCode mirror coherent with the FSM, which has just
    // moved to STOP_C{user_dismissed}. abortFinalization carries no stopSession
    // command, so setStopIntent never fires for this transition — set the code
    // here (the stop timestamp was already captured on entry to STOP_N). This
    // also makes the "skip streaming if terminated" guards treat any late chunk
    // as cancelled, matching the dismissal.
    this.terminationCode = "user_dismissed";
    this.serviceManager
      .getService("transcriptionService")
      .abortSession(sessionId);
  }

  // Clean up resources
  async cleanup(): Promise<void> {
    this.clearTimers();

    // Stop recording if active (performEndRecording handles stopRecording RPC)
    const state = this.getState();
    if (state === "recording" || state === "starting") {
      const commands = this.machine.transition({ type: "signalStop" });
      if (commands.length > 0) {
        await this.machine.runCommands(commands);
      } else {
        // A public active state with no stop command means the derived public
        // state and the FSM predicate have diverged. Force cleanup instead of
        // calling native stop directly and hiding the bug.
        this.logRecordingInvariant(
          "Recording FSM invariant violated during cleanup",
          {
            machineState: this.machine.describeCurrentState(),
            recordingState: this.getState(),
            recordingMode: this.getRecordingMode(),
          },
        );
        await this.forceIdle();
        return;
      }
    }

    // If shutdown catches us mid-stop, wait until native stop has either run or
    // been force-cleaned before any terminal FSM reset.
    if (this.getState() === "stopping") {
      const pendingStopResult = await this.machine.waitForPendingStopSession();

      if (pendingStopResult === "timeout") {
        await this.forceIdle();
        return;
      }

      await this.waitForIdleOrTimeout(CLEANUP_STOPPING_WAIT_TIMEOUT);
      if (this.getState() === "stopping") {
        await this.forceIdle();
        return;
      }
    }

    // Clear any active session
    this.resetSessionState();
  }
}
