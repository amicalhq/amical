import { ipcMain, app } from "electron";
import { EventEmitter } from "node:events";
import { Mutex } from "async-mutex";
import { logger, logPerformance } from "../logger";
import type { ServiceManager } from "@/main/managers/service-manager";
import type { RecordingState } from "../../types/recording";
import type { ShortcutManager } from "./shortcut-manager";
import { StreamingWavWriter } from "../../utils/streaming-wav-writer";
import * as fs from "node:fs";
import * as path from "node:path";

export type RecordingMode = "idle" | "ptt" | "hands-free";
export type TerminationCode =
  | "dismissed"
  | "quick_release"
  | "no_audio"
  | "error";

// Timing thresholds (ms)
const QUICK_PRESS_THRESHOLD = 500;
const NO_AUDIO_TIMEOUT = 5000;
const STUCK_STATE_TIMEOUT = 10000;

/**
 * Manages recording state and coordinates audio recording across the application
 * Acts as the single source of truth for recording status
 *
 * State Machine:
 *   IDLE -> STARTING -> RECORDING -> STOPPING -> IDLE
 *
 * Key design decisions:
 * - Mutex serializes lifecycle operations (doStart, endRecording)
 * - Audio chunks accumulated in memory, file written only at the end
 * - Single terminationCode field determines final action in handleFinalChunk
 */
export class RecordingManager extends EventEmitter {
  // Core state
  private recordingState: RecordingState = "idle";
  private recordingMode: RecordingMode = "idle";

  // Lifecycle mutex - serializes doStart and endRecording
  private lifecycleMutex = new Mutex();

  // Timing
  private recordingInitiatedAt: number | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;
  private noAudioTimer: NodeJS.Timeout | null = null;
  private stuckStateTimer: NodeJS.Timeout | null = null;

  // Session state
  private currentSessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private firstChunkReceived: boolean = false;

  // In-memory audio buffer - written to file only in handleFinalChunk
  private audioChunks: Float32Array[] = [];

  // Termination code - set during stopping to determine final action
  // null = normal (transcribe + paste), "dismissed" = save file only, others = discard
  private terminationCode: TerminationCode | null = null;

  // Performance tracking
  private recordingStartedAt: number | null = null;
  private recordingStoppedAt: number | null = null;

  constructor(private serviceManager: ServiceManager) {
    super();
    this.setupIPCHandlers();
  }

  // Setup listeners for shortcut events
  public setupShortcutListeners(shortcutManager: ShortcutManager) {
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
  }

  private setState(newState: RecordingState): void {
    const oldState = this.recordingState;
    this.recordingState = newState;

    logger.audio.info("Recording state changed", {
      oldState,
      newState,
      sessionId: this.currentSessionId,
    });

    // Broadcast state change to all windows
    this.emit("state-changed", this.getState());
  }

  private setMode(newMode: RecordingMode): void {
    const oldMode = this.recordingMode;
    this.recordingMode = newMode;
    logger.audio.info("Recording mode changed", {
      oldMode,
      newMode,
    });

    // Broadcast mode change to all windows
    this.emit("mode-changed", this.getRecordingMode());
  }

  public getState(): RecordingState {
    return this.recordingState;
  }

  public getRecordingMode(): RecordingMode {
    return this.recordingMode;
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  // PTT key pressed
  public async onPTTPress() {
    // Double-tap detection: timer pending means quick release happened
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
      this.setMode("hands-free");
      logger.audio.info("Double-tap PTT detected, switching to hands-free");
      return;
    }

    // Not recording? Start PTT recording
    if (this.recordingState === "idle") {
      this.recordingInitiatedAt = Date.now();
      await this.doStart("ptt");
      return;
    }

    // Already recording in hands-free mode - handle based on timing
    if (
      this.recordingState === "recording" &&
      this.recordingMode === "hands-free"
    ) {
      if (this.isQuickAction()) {
        logger.audio.info("Quick PTT in hands-free mode, cancelling");
        await this.endRecording("quick_release");
      } else {
        logger.audio.info("PTT in hands-free mode, stopping recording");
        await this.endRecording();
      }
    }
  }

  // PTT key released
  public async onPTTRelease() {
    // Hands-free mode ignores PTT release
    if (this.recordingMode !== "ptt") return;
    if (this.recordingState !== "recording") return;

    if (this.isQuickAction()) {
      // Quick release - wait for potential double-tap before cancelling
      this.cancelTimer = setTimeout(() => {
        this.cancelTimer = null;
        logger.audio.info("Quick release timeout, cancelling");
        this.endRecording("quick_release");
      }, QUICK_PRESS_THRESHOLD);
    } else {
      // Normal release - stop and transcribe
      await this.endRecording();
    }
  }

  // Toggle shortcut pressed
  public async toggleHandsFree() {
    // Double-tap detection: timer pending means quick release happened
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
      this.setMode("hands-free");
      logger.audio.info("Double-tap toggle detected, switching to hands-free");
      return;
    }

    // Not recording? Start hands-free recording
    if (this.recordingState === "idle") {
      this.recordingInitiatedAt = Date.now();
      await this.doStart("hands-free");
      return;
    }

    // Already recording
    if (this.recordingState === "recording") {
      // In PTT mode? Switch to hands-free
      if (this.recordingMode === "ptt") {
        logger.audio.info("Toggle in PTT mode, switching to hands-free");
        this.setMode("hands-free");
        return;
      }

      // In hands-free mode - stop or cancel based on timing
      if (this.recordingMode === "hands-free") {
        if (this.isQuickAction()) {
          logger.audio.info("Quick toggle in hands-free mode, cancelling");
          await this.endRecording("quick_release");
        } else {
          await this.endRecording();
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start recording with mutex protection
   */
  private async doStart(mode: "ptt" | "hands-free") {
    await this.lifecycleMutex.runExclusive(async () => {
      if (this.recordingState !== "idle") {
        logger.audio.warn("Cannot start recording - not idle", {
          currentState: this.recordingState,
        });
        this.recordingInitiatedAt = null;
        return;
      }

      const startTime = performance.now();
      logger.audio.info("RecordingManager: doStart called", { mode });

      // Sync state broadcast
      this.setState("starting");
      this.setMode(mode);
      this.terminationCode = null;
      this.firstChunkReceived = false;
      this.recordingStartedAt = performance.now();
      this.recordingStoppedAt = null;
      this.audioChunks = [];

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.currentSessionId = `session-${timestamp}`;
      this.setState("recording");

      this.startNoAudioTimer();

      // Async init inside mutex
      this.initPromise = this.initializeSession();
      await this.initPromise;

      const totalDuration = performance.now() - startTime;
      logger.audio.info("Recording started", {
        sessionId: this.currentSessionId,
        duration: `${totalDuration.toFixed(2)}ms`,
      });
    });
  }

  /**
   * Initialize session asynchronously
   * No file operations here - chunks accumulate in memory
   */
  private async initializeSession(): Promise<void> {
    try {
      // Reset VAD state for fresh speech detection
      const vadService = this.serviceManager.getService("vadService");
      vadService.reset();

      // Refresh accessibility context (TextMarker API for Electron support)
      const nativeBridge = this.serviceManager.getService("nativeBridge");
      nativeBridge.refreshAccessibilityContext();

      // AWAIT mute to ensure it completes before mutex releases
      await nativeBridge.call("muteSystemAudio", {});
    } catch (error) {
      logger.audio.error("Failed to initialize session", { error });
    }
  }

  /**
   * End recording - unified method for stop and cancel
   * @param code - null for normal stop, or cancellation code
   */
  private async endRecording(
    code: TerminationCode | null = null,
  ): Promise<void> {
    await this.lifecycleMutex.runExclusive(async () => {
      if (this.recordingState !== "recording") {
        logger.audio.warn("Cannot end recording - not recording", {
          currentState: this.recordingState,
        });
        return;
      }

      // Wait for init to complete
      if (this.initPromise) {
        await this.initPromise;
        this.initPromise = null;
      }

      const sessionId = this.currentSessionId;

      logger.audio.info("Ending recording", { sessionId, code });

      // Set termination code and timestamps
      this.terminationCode = code;
      this.recordingStoppedAt = performance.now();

      // State transition first - signals worklet to stop and send final chunk
      this.setState("stopping");
      this.clearTimers();
      this.recordingInitiatedAt = null;
      this.setMode("idle");

      // Restore audio after state change (can happen while final chunk is in flight)
      try {
        const nativeBridge = this.serviceManager.getService("nativeBridge");
        await nativeBridge.call("restoreSystemAudio", {});
      } catch (error) {
        logger.main.warn("Failed to restore system audio", { error });
      }

      // Cancel streaming for cancel codes (not null, not dismissed)
      if (code && code !== "dismissed" && sessionId) {
        try {
          const transcriptionService = this.serviceManager.getService(
            "transcriptionService",
          );
          await transcriptionService.cancelStreamingSession(sessionId);
        } catch (error) {
          logger.audio.warn("Failed to cancel streaming session", { error });
        }
      }

      // Safety timeout for stuck state
      this.stuckStateTimer = setTimeout(() => {
        if (this.recordingState === "stopping") {
          logger.audio.warn("No final chunk received, forcing idle");
          this.forceIdle();
        }
      }, STUCK_STATE_TIMEOUT);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHUNK PROCESSING
  // ═══════════════════════════════════════════════════════════════════

  private async handleAudioChunk(
    chunk: Float32Array,
    isFinalChunk: boolean,
  ): Promise<void> {
    // Only process if recording or stopping
    if (
      this.recordingState !== "recording" &&
      this.recordingState !== "stopping"
    ) {
      logger.audio.debug("Discarding audio chunk - not in active state", {
        state: this.recordingState,
        isFinalChunk,
      });
      return;
    }

    // Wait for async init to complete
    if (this.initPromise) {
      await this.initPromise;
    }

    // Track first chunk for no-audio detection
    if (!this.firstChunkReceived && chunk.length > 0) {
      this.firstChunkReceived = true;
      this.clearNoAudioTimer();
      logger.audio.info("First audio chunk received");
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
            await transcriptionService.processStreamingChunk({
              sessionId: this.currentSessionId,
              audioChunk: chunk,
              recordingStartedAt: this.recordingStartedAt || undefined,
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
    if (this.recordingState !== "recording") {
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
        await transcriptionService.processStreamingChunk({
          sessionId,
          audioChunk: chunk,
          recordingStartedAt: this.recordingStartedAt || undefined,
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

    if (this.recordingState !== "stopping") {
      logger.audio.debug("Unexpected state in handleFinalChunk", {
        state: this.recordingState,
      });
      return;
    }

    const sessionId = this.currentSessionId || "";
    const chunks = this.audioChunks;
    const code = this.terminationCode;

    // CANCELLED (quick_release, no_audio, error) - discard buffer
    if (code && code !== "dismissed") {
      logger.audio.info("Recording cancelled", {
        code,
        chunksDiscarded: chunks.length,
      });

      this.emit("recording-cancelled", { sessionId, code });
      this.audioChunks = [];
      this.resetSessionState();
      this.setState("idle");
      return;
    }

    // Write audio file (for NORMAL and DISMISSED)
    let audioFilePath: string | null = null;

    if (chunks.length > 0) {
      try {
        audioFilePath = await this.createAudioFile(sessionId);
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
      } catch (error) {
        logger.audio.error("Failed to write audio file", { error });
        audioFilePath = null;
      }
    }
    this.audioChunks = [];

    // DISMISSED - just save file, skip transcription
    if (code === "dismissed") {
      // Cancel streaming session to prevent memory leak and audio bleed
      try {
        const transcriptionService = this.serviceManager.getService(
          "transcriptionService",
        );
        await transcriptionService.cancelStreamingSession(sessionId);
      } catch (error) {
        logger.audio.warn("Failed to cancel streaming session", { error });
      }

      this.emit("transcription-dismissed", { sessionId, audioFilePath });
      logger.audio.info("Recording dismissed, file saved for potential undo", {
        audioFilePath,
      });
      this.resetSessionState();
      this.setState("idle");
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
      logger.audio.error("Failed to get final transcription", { error });
    }

    logPerformance("streaming transcription complete", Date.now(), {
      sessionId,
      resultLength: result?.length || 0,
    });

    if (result) {
      await this.pasteTranscription(result);
    } else {
      // Check for empty transcript notification
      const sessionDurationMs =
        this.recordingStoppedAt && this.recordingStartedAt
          ? this.recordingStoppedAt - this.recordingStartedAt
          : 0;
      if (sessionDurationMs > 5000) {
        this.emit("widget-notification", { type: "empty_transcript" });
        logger.audio.info("Emitted widget notification", {
          type: "empty_transcript",
        });
      }
    }

    this.resetSessionState();
    this.setState("idle");
  }

  // ═══════════════════════════════════════════════════════════════════
  // DISMISS SUPPORT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Dismiss the current recording (called during stopping state)
   * Saves audio file but skips transcription
   */
  public dismiss(): void {
    if (this.recordingState === "stopping") {
      this.terminationCode = "dismissed";
      logger.audio.info("Recording dismissed");
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════

  private isQuickAction(): boolean {
    if (!this.recordingInitiatedAt) return false;
    return Date.now() - this.recordingInitiatedAt < QUICK_PRESS_THRESHOLD;
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
  }

  private clearNoAudioTimer(): void {
    if (this.noAudioTimer) {
      clearTimeout(this.noAudioTimer);
      this.noAudioTimer = null;
    }
  }

  private startNoAudioTimer(): void {
    this.noAudioTimer = setTimeout(() => {
      if (this.recordingState === "recording" && !this.firstChunkReceived) {
        logger.audio.warn("No audio detected for 5 seconds");
        this.emit("no-audio-detected");
        this.emit("widget-notification", { type: "no_audio" });
        logger.audio.info("Emitted widget notification", { type: "no_audio" });
        this.endRecording("no_audio");
      }
    }, NO_AUDIO_TIMEOUT);
  }

  private async forceIdle(): Promise<void> {
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

    this.audioChunks = [];
    this.resetSessionState();
    this.setState("idle");
  }

  private resetSessionState(): void {
    this.currentSessionId = null;
    this.initPromise = null;
    this.firstChunkReceived = false;
    this.recordingInitiatedAt = null;
    this.recordingMode = "idle";
    this.audioChunks = [];
    this.terminationCode = null;
    this.clearTimers();
  }

  /**
   * Create audio file for recording session
   */
  private async createAudioFile(sessionId: string): Promise<string> {
    const audioDir = path.join(app.getPath("temp"), "grizzo-audio");
    await fs.promises.mkdir(audioDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(audioDir, `audio-${sessionId}-${timestamp}.wav`);

    logger.audio.info("Created audio file for session", {
      sessionId,
      filePath,
    });

    return filePath;
  }

  private async pasteTranscription(transcription: string): Promise<void> {
    if (!transcription || typeof transcription !== "string") {
      logger.main.warn("Invalid transcription, not pasting");
      return;
    }

    try {
      const nativeBridge = this.serviceManager.getService("nativeBridge");

      logger.main.info("Pasting transcription to active application", {
        textLength: transcription.length,
      });

      if (nativeBridge) {
        nativeBridge.call("pasteText", {
          transcript: transcription,
        });
      }
    } catch (error) {
      logger.main.warn(
        "Native bridge not available, cannot paste transcription",
        { error: error instanceof Error ? error.message : String(error) },
      );
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
    if (this.recordingState === "idle") {
      this.recordingInitiatedAt = Date.now();
      await this.doStart("hands-free");
    }
  }

  /**
   * Signal to stop recording (called from tRPC)
   */
  public async signalStop(): Promise<void> {
    if (this.recordingState === "recording") {
      await this.endRecording();
    }
  }

  // Clean up resources
  async cleanup(): Promise<void> {
    this.clearTimers();

    // Stop recording if active
    if (this.recordingState === "recording") {
      await this.endRecording();
    }

    // Clear any active session
    this.resetSessionState();
    this.setState("idle");
  }
}
