import {
  PipelineContext,
  StreamingPipelineContext,
  StreamingSession,
} from "../pipeline/core/pipeline-types";
import { createDefaultContext } from "../pipeline/core/context";
import { WhisperProvider } from "../pipeline/providers/transcription/whisper-provider";
import { OpenRouterProvider } from "../pipeline/providers/formatting/openrouter-formatter";
import { ModelManagerService } from "../services/model-manager";
import { SettingsService } from "../services/settings-service";
import { appContextStore } from "../stores/app-context";
import { createTranscription } from "../db/transcriptions";
import { logger } from "../main/logger";
import { v4 as uuid } from "uuid";
import { VADService } from "./vad-service";
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { convertRawToWav } from "../utils/audio-converter";

/**
 * Service for audio transcription and optional formatting
 */
interface ExtendedStreamingSession extends StreamingSession {
  audioFileStream?: fs.WriteStream;
  audioFilePath?: string;
  audioBuffers?: Buffer[];
}

export class TranscriptionService {
  private whisperProvider: WhisperProvider;
  private openRouterProvider: OpenRouterProvider | null = null;
  private formatterEnabled = false;
  private streamingSessions: Map<string, ExtendedStreamingSession> = new Map();
  private vadService: VADService | null;
  private settingsService: SettingsService;

  constructor(
    modelManagerService: ModelManagerService,
    vadService: VADService | null,
    settingsService: SettingsService,
  ) {
    this.whisperProvider = new WhisperProvider(modelManagerService);
    this.vadService = vadService;
    this.settingsService = settingsService;
  }

  async initialize(): Promise<void> {
    if (this.vadService) {
      logger.transcription.info("Using VAD service");
    } else {
      logger.transcription.warn("VAD service not available");
    }

    // Check if we should preload Whisper model
    const transcriptionSettings =
      await this.settingsService.getTranscriptionSettings();
    const shouldPreload = transcriptionSettings?.preloadWhisperModel !== false; // Default to true

    if (shouldPreload) {
      logger.transcription.info("Preloading Whisper model...");
      await this.preloadWhisperModel();
      logger.transcription.info("Whisper model preloaded successfully");
    } else {
      logger.transcription.info("Whisper model preloading disabled");
    }

    logger.transcription.info("Transcription service initialized");
  }

  /**
   * Preload Whisper model into memory
   */
  async preloadWhisperModel(): Promise<void> {
    try {
      // This will trigger the model initialization in WhisperProvider
      await this.whisperProvider.preloadModel();
      logger.transcription.info("Whisper model preloaded successfully");
    } catch (error) {
      logger.transcription.error("Failed to preload Whisper model:", error);
      throw error;
    }
  }

  /**
   * Handle model change - dispose old model and load new one if preloading is enabled
   */
  async handleModelChange(): Promise<void> {
    try {
      // Dispose current model
      await this.whisperProvider.dispose();

      // Check if preloading is enabled
      if (this.settingsService) {
        const transcriptionSettings =
          await this.settingsService.getTranscriptionSettings();
        const shouldPreload =
          transcriptionSettings?.preloadWhisperModel !== false;

        if (shouldPreload) {
          logger.transcription.info(
            "Reloading Whisper model after model change...",
          );
          await this.whisperProvider.preloadModel();
          logger.transcription.info("Whisper model reloaded successfully");
        }
      }
    } catch (error) {
      logger.transcription.error("Failed to handle model change:", error);
      // Don't throw - model will be loaded on first use
    }
  }

  /**
   * Configure formatter for post-processing
   */
  configureFormatter(config: any): void {
    if (!config?.enabled) {
      this.openRouterProvider = null;
      this.formatterEnabled = false;
      logger.transcription.info("Formatter disabled");
      return;
    }

    if (config.provider === "openrouter" && config.apiKey && config.model) {
      this.openRouterProvider = new OpenRouterProvider(
        config.apiKey,
        config.model,
      );
      this.formatterEnabled = true;
      logger.transcription.info("Formatter configured", {
        provider: config.provider,
      });
    } else {
      logger.transcription.warn("Invalid formatter configuration");
      this.openRouterProvider = null;
      this.formatterEnabled = false;
    }
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

    logger.transcription.info("Created audio file for session", {
      sessionId,
      filePath,
    });

    return filePath;
  }

  /**
   * Process a single audio chunk in streaming mode
   */
  async processStreamingChunk(options: {
    sessionId: string;
    audioChunk: Buffer;
    isFinal?: boolean;
  }): Promise<string> {
    const { sessionId, audioChunk, isFinal = false } = options;
    console.error("processing streaming chunk", {
      length: audioChunk.length,
    });

    // Run VAD on the audio chunk
    let speechProbability = 0;
    let isSpeaking = false;

    if (audioChunk.length > 0 && this.vadService) {
      const vadResult = await this.vadService.processAudioFrame(
        audioChunk.buffer as ArrayBuffer,
      );
      speechProbability = vadResult.probability;
      isSpeaking = vadResult.isSpeaking;

      logger.transcription.debug("VAD result", {
        probability: speechProbability.toFixed(3),
        isSpeaking,
      });
    }

    // Auto-create session if it doesn't exist
    let session = this.streamingSessions.get(sessionId);
    if (!session) {
      const context = await this.buildContext();
      const streamingContext: StreamingPipelineContext = {
        ...context,
        sessionId,
        isPartial: true,
        isFinal: false,
        accumulatedTranscription: [],
      };

      // Get accessibility context from global store
      streamingContext.sharedData.accessibilityContext =
        appContextStore.getAccessibilityContext();

      // Create audio file for this session
      const audioFilePath = await this.createAudioFile(sessionId);

      session = {
        context: streamingContext,
        transcriptionResults: [],
        audioFilePath,
        audioBuffers: [],
      };

      this.streamingSessions.set(sessionId, session);
      logger.transcription.info("Started streaming session", {
        sessionId,
        audioFilePath,
      });
    }

    // Buffer audio chunks - we'll write WAV at the end
    if (audioChunk.length > 0) {
      session.audioBuffers!.push(audioChunk);
    }

    // Process chunk if it has content
    if (audioChunk.length > 0) {
      // Direct frame to Whisper - it will handle aggregation and VAD internally
      const previousChunk =
        session.transcriptionResults.length > 0
          ? session.transcriptionResults[
              session.transcriptionResults.length - 1
            ]
          : undefined;
      const aggregatedTranscription = session.transcriptionResults
        .join(" ")
        .trim();

      const chunkTranscription = await this.whisperProvider.transcribe({
        audioData: audioChunk,
        speechProbability: speechProbability, // Now from VAD service
        context: {
          vocabulary: session.context.sharedData.vocabulary,
          accessibilityContext: session.context.sharedData.accessibilityContext,
          previousChunk,
          aggregatedTranscription: aggregatedTranscription || undefined,
        },
      });

      // Accumulate the result only if Whisper returned something
      // (it returns empty string while buffering)
      if (chunkTranscription.trim()) {
        session.transcriptionResults.push(chunkTranscription);
        logger.transcription.info("Whisper returned transcription", {
          sessionId,
          transcriptionLength: chunkTranscription.length,
          totalResults: session.transcriptionResults.length,
        });
      }

      logger.transcription.error("Processed frame", {
        sessionId,
        frameSize: audioChunk.length,
        hadTranscription: chunkTranscription.length > 0,
        isFinal,
      });
    }

    // If this is the final chunk, flush any remaining audio and apply formatting
    if (isFinal) {
      if (!session) {
        logger.transcription.error("No session found for final chunk", {
          sessionId,
        });
        return "";
      }
      // Flush any remaining buffered audio in Whisper
      if (this.whisperProvider.flush) {
        const flushResult = await this.whisperProvider.flush();
        if (flushResult.trim()) {
          session.transcriptionResults.push(flushResult);
          logger.transcription.info("Flushed final audio", {
            sessionId,
            flushLength: flushResult.length,
          });
        }
      }

      // Get complete transcription
      let completeTranscription = session.transcriptionResults.join(" ").trim();

      logger.transcription.info("Finalizing streaming session", {
        sessionId,
        rawTranscriptionLength: completeTranscription.length,
        chunkCount: session.transcriptionResults.length,
      });

      // Format if enabled (currently disabled with && false)
      // Commenting out to fix TypeScript errors since this code path is never executed
      /*
      if (this.formatterEnabled && this.openRouterProvider && false) {
        const style =
          session.context.sharedData.userPreferences?.formattingStyle;
        completeTranscription = await this.openRouterProvider.format({
          text: completeTranscription,
          context: {
            style,
            vocabulary: session.context.sharedData.vocabulary,
            accessibilityContext:
              session.context.sharedData.accessibilityContext,
            previousChunk:
              session.transcriptionResults.length > 1
                ? session.transcriptionResults[
                    session.transcriptionResults.length - 2
                  ]
                : undefined,
            aggregatedTranscription: completeTranscription,
          },
        });
      }
      */

      // Convert buffered audio to WAV and save
      if (
        session.audioBuffers &&
        session.audioBuffers.length > 0 &&
        session.audioFilePath
      ) {
        // Concatenate all audio buffers
        const totalLength = session.audioBuffers.reduce(
          (acc, buf) => acc + buf.length,
          0,
        );
        const combinedBuffer = Buffer.concat(session.audioBuffers, totalLength);

        // Convert to WAV
        const wavBuffer = convertRawToWav(combinedBuffer);

        // Write WAV file
        await fs.promises.writeFile(session.audioFilePath, wavBuffer);

        logger.transcription.info("Saved audio as WAV file", {
          sessionId,
          filePath: session.audioFilePath,
          size: wavBuffer.length,
        });
      }

      // Save directly to database
      logger.transcription.info("Saving transcription with audio file", {
        sessionId,
        audioFilePath: session.audioFilePath,
        hasAudioFile: !!session.audioFilePath,
      });

      await createTranscription({
        text: completeTranscription,
        language: session.context.sharedData.userPreferences?.language || "en",
        duration: session.context.sharedData.audioMetadata?.duration,
        speechModel: "whisper-local",
        formattingModel: this.formatterEnabled ? "openrouter" : undefined,
        audioFile: session.audioFilePath,
        meta: {
          sessionId,
          source: session.context.sharedData.audioMetadata?.source,
          vocabularySize: session.context.sharedData.vocabulary?.size || 0,
          formattingStyle:
            session.context.sharedData.userPreferences?.formattingStyle,
        },
      });

      this.streamingSessions.delete(sessionId);

      logger.transcription.info("Streaming session completed", { sessionId });
      return completeTranscription;
    }

    // Return accumulated transcription so far (for UI feedback)
    return session ? session.transcriptionResults.join(" ") : "";
  }

  private async buildContext(): Promise<PipelineContext> {
    // Create default context
    const context = createDefaultContext(uuid());

    // TODO: Load actual vocabulary
    // TODO: Load user preferences from settings
    // TODO: Load formatter config from settings

    return context;
  }

  /**
   * Cleanup method
   */
  async dispose(): Promise<void> {
    await this.whisperProvider.dispose();
    // VAD service is managed by ServiceManager
    logger.transcription.info("Transcription service disposed");
  }
}
