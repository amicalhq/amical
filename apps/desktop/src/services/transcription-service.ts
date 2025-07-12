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
import { Mutex } from "async-mutex";

/**
 * Service for audio transcription and optional formatting
 */
export class TranscriptionService {
  private whisperProvider: WhisperProvider;
  private openRouterProvider: OpenRouterProvider | null = null;
  private formatterEnabled = false;
  private streamingSessions: Map<string, StreamingSession> = new Map();
  private vadService: VADService | null;
  private settingsService: SettingsService;
  private vadMutex: Mutex;
  private transcriptionMutex: Mutex;

  constructor(
    modelManagerService: ModelManagerService,
    vadService: VADService | null,
    settingsService: SettingsService,
  ) {
    this.whisperProvider = new WhisperProvider(modelManagerService);
    this.vadService = vadService;
    this.settingsService = settingsService;
    this.vadMutex = new Mutex();
    this.transcriptionMutex = new Mutex();
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
   * Process a single audio chunk in streaming mode
   */
  async processStreamingChunk(options: {
    sessionId: string;
    audioChunk: Float32Array;
    isFinal?: boolean;
    audioFilePath?: string;
  }): Promise<string> {
    const { sessionId, audioChunk, isFinal = false, audioFilePath } = options;

    // Run VAD on the audio chunk
    let speechProbability = 0;
    let isSpeaking = false;

    if (audioChunk.length > 0 && this.vadService) {
      // Acquire VAD mutex
      await this.vadMutex.acquire();

      // Pass Float32Array directly to VAD
      const vadResult = await this.vadService.processAudioFrame(audioChunk);

      // Release VAD mutex
      this.vadMutex.release();

      speechProbability = vadResult.probability;
      isSpeaking = vadResult.isSpeaking;

      logger.transcription.debug("VAD result", {
        probability: speechProbability.toFixed(3),
        isSpeaking,
      });
    }

    // Acquire transcription mutex
    await this.transcriptionMutex.acquire();

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

      session = {
        context: streamingContext,
        transcriptionResults: [],
      };

      this.streamingSessions.set(sessionId, session);

      logger.transcription.info("Started streaming session", {
        sessionId,
      });
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
        flush: isFinal,
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

      logger.transcription.debug("Processed frame", {
        sessionId,
        frameSize: audioChunk.length,
        hadTranscription: chunkTranscription.length > 0,
        isFinal,
      });
    }

    // Release transcription mutex
    this.transcriptionMutex.release();
    const completeTranscriptionTillNow = session.transcriptionResults
      .join(" ")
      .trim();

    // this is the final chunk, save the transcription
    if (!isFinal) {
      return completeTranscriptionTillNow;
    }

    let completeTranscription = completeTranscriptionTillNow;

    logger.transcription.info("Finalizing streaming session", {
      sessionId,
      rawTranscriptionLength: completeTranscription.length,
      chunkCount: session.transcriptionResults.length,
    });

    if (this.formatterEnabled && this.openRouterProvider) {
      try {
        const style =
          session.context.sharedData.userPreferences?.formattingStyle;
        const formattedText = await this.openRouterProvider.format({
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

        logger.transcription.info("Text formatted successfully", {
          sessionId,
          originalLength: completeTranscription.length,
          formattedLength: formattedText.length,
        });

        completeTranscription = formattedText;
      } catch (error) {
        logger.transcription.error(
          "Formatting failed, using unformatted text",
          {
            sessionId,
            error,
          },
        );
        // Continue with unformatted text
      }
    }

    // Save directly to database
    logger.transcription.info("Saving transcription with audio file", {
      sessionId,
      audioFilePath,
      hasAudioFile: !!audioFilePath,
    });

    await createTranscription({
      text: completeTranscription,
      language: session.context.sharedData.userPreferences?.language || "en",
      duration: session.context.sharedData.audioMetadata?.duration,
      speechModel: "whisper-local",
      formattingModel: this.formatterEnabled ? "openrouter" : undefined,
      audioFile: audioFilePath,
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
