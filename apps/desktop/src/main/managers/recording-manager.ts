import { ipcMain, app, dialog } from "electron";
import type { TranscriptionService } from "../../services/transcription-service";
import { EventEmitter } from "node:events";
import { logger, logPerformance } from "../logger";
import { ServiceManager } from "./service-manager";
import type { RecordingState } from "../../types/recording";
import { Mutex } from "async-mutex";
import type { ShortcutManager } from "../services/shortcut-manager";
import { StreamingWavWriter } from "../../utils/streaming-wav-writer";
import * as fs from "node:fs";
import * as path from "node:path";
import { appContextStore } from "@/stores/app-context";

export type RecordingMode = "idle" | "ptt" | "hands-free";

/**
 * Manages recording state and coordinates audio recording across the application
 * Acts as the single source of truth for recording status
 */
export class RecordingManager extends EventEmitter {
  private currentSessionId: string | null = null;
  private recordingState: RecordingState = "idle";
  private recordingMutex = new Mutex();
  private recordingMode: RecordingMode = "idle";
  private currentAudioRecording: {
    audioFilePath: string;
    wavWriter: StreamingWavWriter;
  } | null = null;

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
          await this.startPTT();
        } else {
          await this.stopPTT();
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
    this.broadcastStateChange();
  }

  private setMode(newMode: RecordingMode): void {
    const oldMode = this.recordingMode;
    this.recordingMode = newMode;
    logger.audio.info("Recording mode changed", {
      oldMode,
      newMode,
    });

    // Broadcast mode change to all windows
    this.broadcastModeChange();
  }

  public getState(): RecordingState {
    return this.recordingState;
  }

  private broadcastStateChange(): void {
    // Emit event for internal listeners (tRPC subscription will pick this up)
    this.emit("state-changed", this.getState());
  }

  private broadcastModeChange(): void {
    // Emit event for internal listeners (tRPC subscription will pick this up)
    this.emit("mode-changed", this.getRecordingMode());
  }

  /**
   * Create audio file for recording session
   */
  private async createAudioFile(sessionId: string): Promise<string> {
    // Create audio directory in app temp path
    const audioDir = path.join(app.getPath("temp"), "amical-audio");
    await fs.promises.mkdir(audioDir, { recursive: true });

    // Create file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(audioDir, `audio-${sessionId}-${timestamp}.wav`);

    logger.audio.info("Created audio file for session", {
      sessionId,
      filePath,
    });

    return filePath;
  }

  private setupIPCHandlers(): void {
    // Handle audio data chunks from renderer
    ipcMain.handle(
      "audio-data-chunk",
      async (event, chunk: ArrayBuffer, isFinalChunk: boolean) => {
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

    // Handle log messages from renderer processes
    ipcMain.handle(
      "log-message",
      (event, level: string, scope: string, ...args: any[]) => {
        const scopedLogger =
          logger[scope as keyof typeof logger] || logger.renderer;
        const logMethod = scopedLogger[level as keyof typeof scopedLogger];
        if (typeof logMethod === "function") {
          logMethod(...args);
        }
      },
    );
  }

  public async startRecording(mode: "ptt" | "hands-free") {
    await this.recordingMutex.runExclusive(async () => {
      // Check if transcription service is available and has models
      const transcriptionService = this.serviceManager.getService(
        "transcriptionService",
      );
      if (!transcriptionService) {
        logger.audio.error("Transcription service not available");
        // Show error dialog
        dialog.showErrorBox(
          "Recording Failed",
          "Transcription service is not available. Please restart the application.",
        );
        return;
      }

      const hasModels = await transcriptionService.isModelAvailable();
      if (!hasModels) {
        logger.audio.error("No transcription models available");
        // Show error dialog
        dialog.showErrorBox(
          "No Models Available",
          "Please download a transcription model from Speech Models before recording.",
        );
        return;
      }
      // if we were previously in ptt mode, we override
      // priority is given to hands-free mode
      // we don't need to check the other way around
      if (mode === "hands-free") {
        this.setMode("hands-free");
      }

      // Check if already recording
      if (this.recordingState !== "idle") {
        logger.audio.warn("Cannot start recording - already in progress", {
          currentState: this.recordingState,
        });
        return;
      }

      this.setState("starting");
      this.setMode(mode);

      // Create session ID
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.currentSessionId = `session-${timestamp}`;

      // Get accessibility context from global store
      appContextStore.refreshAccessibilityData();

      // Create audio file and WAV writer
      const audioFilePath = await this.createAudioFile(this.currentSessionId);
      this.currentAudioRecording = {
        audioFilePath,
        wavWriter: new StreamingWavWriter(audioFilePath),
      };

      logger.audio.info("Audio recording initialized", {
        sessionId: this.currentSessionId,
        audioFilePath,
      });

      // Mute system audio
      try {
        const swiftBridge = this.serviceManager.getService("swiftIOBridge");
        if (swiftBridge) {
          await swiftBridge.call("muteSystemAudio", {});
        }
      } catch (error) {
        logger.main.warn("Swift bridge not available for audio muting");
      }

      this.setState("recording");
      logger.audio.info("Recording started successfully", {
        sessionId: this.currentSessionId,
      });

      return;
    });
  }

  public async stopRecording() {
    await this.recordingMutex.runExclusive(async () => {
      // Check if recording
      if (this.recordingState !== "recording") {
        logger.audio.warn("Cannot stop recording - not currently recording", {
          currentState: this.recordingState,
        });
        return;
      }

      this.setState("stopping");

      // Reset recording mode when stopping
      this.recordingMode = "idle";

      // Restore system audio
      try {
        const swiftBridge = this.serviceManager.getService("swiftIOBridge");
        if (swiftBridge) {
          await swiftBridge.call("restoreSystemAudio", {});
        }
      } catch (error) {
        logger.main.warn("Swift bridge not available for audio restore");
      }

      logger.audio.info("Recording stop initiated", {
        sessionId: this.currentSessionId,
      });

      // State will transition to "idle" when final chunk is processed
      // Session will be cleared when final chunk is processed
      return;
    });
  }

  // PTT-specific methods
  public async startPTT() {
    this.startRecording("ptt");
  }

  public async stopPTT() {
    if (this.recordingMode !== "ptt") {
      return;
    }
    this.stopRecording();
  }

  // Hands-free mode toggle
  public async toggleHandsFree() {
    if (this.recordingState === "idle") {
      this.startRecording("hands-free");
      return;
    }
    if (this.recordingMode === "hands-free") {
      this.stopRecording();
      return;
    }
    this.startRecording("hands-free");
    return;
  }

  // Get current mode
  public getRecordingMode(): RecordingMode {
    return this.recordingMode;
  }

  private async handleAudioChunk(
    chunk: Float32Array,
    isFinalChunk: boolean,
  ): Promise<void> {
    // Validate we're in a recording state
    if (
      this.recordingState !== "recording" &&
      this.recordingState !== "stopping"
    ) {
      logger.audio.error("Received audio chunk while not recording", {
        state: this.recordingState,
        isFinalChunk,
      });
      return;
    }

    // Session should already exist from startRecording
    if (!this.currentSessionId || !this.currentAudioRecording) {
      logger.audio.error(
        "No session ID or audio recording found while handling audio chunk",
      );
      return;
    }

    // Skip empty chunks unless it's the final one
    if (chunk.length === 0 && !isFinalChunk) {
      logger.audio.debug("Skipping empty non-final chunk");
      return;
    }

    await this.currentAudioRecording.wavWriter.appendAudio(chunk);

    try {
      const transcriptionService = this.serviceManager.getService(
        "transcriptionService",
      );
      if (!transcriptionService) {
        throw new Error("Transcription service not available");
      }
      const startTime = Date.now();

      // Process the chunk - pass isFinal flag and audio file path
      const transcriptionResult =
        await transcriptionService.processStreamingChunk({
          sessionId: this.currentSessionId,
          audioChunk: chunk,
          isFinal: isFinalChunk,
          audioFilePath: this.currentAudioRecording.audioFilePath,
        });

      logger.audio.debug("Processed audio chunk", {
        chunkSize: chunk.length,
        processingTimeMs: Date.now() - startTime,
        resultLength: transcriptionResult.length,
        isFinal: isFinalChunk,
      });

      // If this was the final chunk, handle completion
      if (isFinalChunk) {
        // Finalize the WAV file
        await this.currentAudioRecording.wavWriter.finalize();
        logger.audio.info("Finalized WAV file", {
          sessionId: this.currentSessionId,
          filePath: this.currentAudioRecording.audioFilePath,
          dataSize: this.currentAudioRecording.wavWriter.getDataSize(),
        });

        logPerformance("streaming transcription complete", startTime, {
          sessionId: this.currentSessionId,
          resultLength: transcriptionResult?.length || 0,
        });

        logger.audio.info("Streaming transcription completed", {
          sessionId: this.currentSessionId,
          resultLength: transcriptionResult?.length || 0,
          hasResult: !!transcriptionResult,
        });

        // Paste the final formatted transcription
        if (transcriptionResult) {
          await this.pasteTranscription(transcriptionResult);
        }

        // Clean up session and audio recording
        this.currentSessionId = null;
        this.currentAudioRecording = null;

        // Ensure state is idle after completion
        if (this.recordingState === "stopping") {
          this.setState("idle");
        }
      }
    } catch (error) {
      logger.audio.error("Error processing audio chunk:", error);

      if (isFinalChunk) {
        // Clean up session and audio recording on error
        this.currentSessionId = null;
        this.currentAudioRecording = null;
        this.setState("error");
      }
    }
  }

  private async pasteTranscription(transcription: string): Promise<void> {
    if (!transcription || typeof transcription !== "string") {
      logger.main.warn("Invalid transcription, not pasting");
      return;
    }

    try {
      const swiftBridge = this.serviceManager.getService("swiftIOBridge");

      logger.main.info("Pasting transcription to active application", {
        textLength: transcription.length,
      });

      if (swiftBridge) {
        swiftBridge.call("pasteText", {
          transcript: transcription,
        });
      }
    } catch (error) {
      logger.main.warn(
        "Swift bridge not available, cannot paste transcription",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  // Clean up resources
  async cleanup(): Promise<void> {
    // Stop recording if active
    if (
      this.recordingState === "recording" ||
      this.recordingState === "starting"
    ) {
      await this.stopRecording();
    }

    // Clear any active session and audio recording
    this.currentSessionId = null;
    this.currentAudioRecording = null;
    this.setState("idle");
  }
}
