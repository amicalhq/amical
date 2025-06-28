import { ipcMain } from "electron";
import { EventEmitter } from "node:events";
import { logger, logPerformance } from "../main/logger";
import { ServiceManager } from "../main/managers/service-manager";
import { appContextStore } from "../stores/app-context";

/**
 * Handles audio recording via IPC and coordinates with the pipeline system
 * This service manages the recording flow but delegates actual processing to the pipeline
 */
export class RecordingService extends EventEmitter {
  private currentSessionId: string | null = null;

  constructor(private serviceManager: ServiceManager) {
    super();
    this.setupIPCHandlers();
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

    ipcMain.handle("recording-starting", async () => {
      logger.audio.info("Recording starting");
      await this.handleRecordingStarting();
    });

    ipcMain.handle("recording-stopping", async () => {
      logger.audio.info("Recording stopping");
      await this.handleRecordingStopping();
    });

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

  private async handleAudioChunk(
    chunk: Buffer,
    isFinalChunk: boolean,
  ): Promise<void> {
    // Start new session if needed
    if (!this.currentSessionId) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.currentSessionId = `session-${timestamp}`;

      logger.audio.info("Started new streaming session", {
        sessionId: this.currentSessionId,
      });
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
      }
    } catch (error) {
      logger.audio.error("Error processing audio chunk:", error);

      if (isFinalChunk) {
        // Clean up session on error
        this.currentSessionId = null;
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

  private async handleRecordingStarting(): Promise<void> {
    // Refresh accessibility context - fire and forget
    appContextStore.refreshAccessibilityData();

    // Mute system audio
    try {
      const swiftBridge = this.serviceManager.getSwiftIOBridge();
      await swiftBridge.call("muteSystemAudio", {});
    } catch (error) {
      logger.main.warn("Swift bridge not available for audio muting");
    }

    // TODO: Preload models if needed (Phase 2)
  }

  private async handleRecordingStopping(): Promise<void> {
    // Restore system audio
    try {
      const swiftBridge = this.serviceManager.getSwiftIOBridge();
      await swiftBridge.call("restoreSystemAudio", {});
    } catch (error) {
      logger.main.warn("Swift bridge not available for audio restore");
    }
  }

  // Clean up resources
  async cleanup(): Promise<void> {
    // Clear any active session
    this.currentSessionId = null;
  }
}
