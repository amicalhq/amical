import { ipcMain } from "electron";
import { EventEmitter } from "node:events";
import { logger, logPerformance } from "../logger";
import { ServiceManager } from "./service-manager";
import { appContextStore } from "../../stores/app-context";
import type { RecordingState, RecordingStatus } from "../../types/recording";
import { WindowManager } from "../core/window-manager";

/**
 * Manages recording state and coordinates audio recording across the application
 * Acts as the single source of truth for recording status
 */
export class RecordingManager extends EventEmitter {
  private currentSessionId: string | null = null;
  private recordingState: RecordingState = "idle";
  private lastError: string | undefined;
  private windowManager: WindowManager | null = null;

  constructor(private serviceManager: ServiceManager) {
    super();
    this.setupIPCHandlers();
  }

  public setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager;
  }

  private setState(newState: RecordingState, error?: string): void {
    const oldState = this.recordingState;
    this.recordingState = newState;
    this.lastError = error;

    logger.audio.info("Recording state changed", {
      oldState,
      newState,
      sessionId: this.currentSessionId,
      error,
    });

    // Broadcast state change to all windows
    this.broadcastStateChange();
  }

  private broadcastStateChange(): void {
    const status = this.getStatus();

    // Emit event for internal listeners (tRPC subscription will pick this up)
    this.emit("state-changed", status);
  }

  public getStatus(): RecordingStatus {
    return {
      state: this.recordingState,
      sessionId: this.currentSessionId,
      error: this.lastError,
    };
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

        const buffer = Buffer.from(chunk);
        logger.audio.info("Received audio chunk", {
          size: buffer.byteLength,
          isFinalChunk,
        });

        await this.handleAudioChunk(buffer, isFinalChunk);
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

  public async startRecording(): Promise<RecordingStatus> {
    // Check if already recording
    if (this.recordingState !== "idle" && this.recordingState !== "error") {
      logger.audio.warn("Cannot start recording - already in progress", {
        currentState: this.recordingState,
      });
      return this.getStatus();
    }

    try {
      this.setState("starting");

      // Create session ID
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.currentSessionId = `session-${timestamp}`;

      // Mute system audio
      try {
        const swiftBridge = this.serviceManager.getSwiftIOBridge();
        await swiftBridge.call("muteSystemAudio", {});
      } catch (error) {
        logger.main.warn("Swift bridge not available for audio muting");
      }

      // Refresh accessibility context - fire and forget
      // appContextStore.refreshAccessibilityData();

      // TODO: Preload models if needed (Phase 2)

      this.setState("recording");
      logger.audio.info("Recording started successfully", {
        sessionId: this.currentSessionId,
      });

      return this.getStatus();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.audio.error("Failed to start recording", { error: errorMessage });
      this.setState("error", errorMessage);
      this.currentSessionId = null;
      return this.getStatus();
    }
  }

  public async stopRecording(): Promise<RecordingStatus> {
    // Check if recording
    if (this.recordingState !== "recording") {
      logger.audio.warn("Cannot stop recording - not currently recording", {
        currentState: this.recordingState,
      });
      return this.getStatus();
    }

    try {
      this.setState("stopping");

      // Restore system audio
      try {
        const swiftBridge = this.serviceManager.getSwiftIOBridge();
        await swiftBridge.call("restoreSystemAudio", {});
      } catch (error) {
        logger.main.warn("Swift bridge not available for audio restore");
      }

      this.setState("idle");
      logger.audio.info("Recording stopped successfully", {
        sessionId: this.currentSessionId,
      });

      // Session will be cleared when final chunk is processed
      return this.getStatus();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.audio.error("Failed to stop recording", { error: errorMessage });
      this.setState("error", errorMessage);
      return this.getStatus();
    }
  }

  private async handleAudioChunk(
    chunk: Buffer,
    isFinalChunk: boolean,
  ): Promise<void> {
    // Validate we're in a recording state
    if (
      this.recordingState !== "recording" &&
      this.recordingState !== "stopping"
    ) {
      logger.audio.warn("Received audio chunk while not recording", {
        state: this.recordingState,
        isFinalChunk,
      });
      return;
    }

    // Session should already exist from startRecording
    if (!this.currentSessionId) {
      logger.audio.error("No session ID found while handling audio chunk");
      return;
    }

    // Skip empty chunks unless it's the final one
    if (chunk.length === 0 && !isFinalChunk) {
      logger.audio.debug("Skipping empty non-final chunk");
      return;
    }

    try {
      const transcriptionService =
        this.serviceManager.getTranscriptionService();
      const startTime = Date.now();

      // Process the chunk - pass isFinal flag
      const transcriptionResult =
        await transcriptionService.processStreamingChunk({
          sessionId: this.currentSessionId,
          audioChunk: chunk,
          isFinal: isFinalChunk,
        });

      logger.audio.debug("Processed audio chunk", {
        chunkSize: chunk.length,
        processingTimeMs: Date.now() - startTime,
        resultLength: transcriptionResult.length,
        isFinal: isFinalChunk,
      });

      // If this was the final chunk, handle completion
      if (isFinalChunk) {
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

        // Clean up session
        this.currentSessionId = null;

        // Ensure state is idle after completion
        if (this.recordingState === "stopping") {
          this.setState("idle");
        }
      }
    } catch (error) {
      logger.audio.error("Error processing audio chunk:", error);

      if (isFinalChunk) {
        // Clean up session on error
        this.currentSessionId = null;
        this.setState(
          "error",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  private async pasteTranscription(transcription: string): Promise<void> {
    if (!transcription || typeof transcription !== "string") {
      logger.main.warn("Invalid transcription, not pasting");
      return;
    }

    try {
      const swiftBridge = this.serviceManager.getSwiftIOBridge();

      logger.main.info("Pasting transcription to active application", {
        textLength: transcription.length,
      });

      swiftBridge.call("pasteText", {
        transcript: transcription,
      });
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

    // Clear any active session
    this.currentSessionId = null;
    this.setState("idle");
  }
}
