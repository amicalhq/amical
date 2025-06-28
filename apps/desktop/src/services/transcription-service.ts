import {
  PipelineContext,
  StreamingPipelineContext,
  StreamingSession,
} from "../pipeline/core/pipeline-types";
import { createDefaultContext } from "../pipeline/core/context";
import { WhisperProvider } from "../pipeline/providers/transcription/whisper-provider";
import { OpenRouterProvider } from "../pipeline/providers/formatting/openrouter-formatter";
import { ModelManagerService } from "../services/model-manager";
import { ServiceManager } from "../main/managers/service-manager";
import { appContextStore } from "../stores/app-context";
import { createTranscription } from "../db/transcriptions";
import { logger } from "../main/logger";
import { v4 as uuid } from "uuid";

/**
 * Service for audio transcription and optional formatting
 */
export class TranscriptionService {
  private whisperProvider: WhisperProvider;
  private openRouterProvider: OpenRouterProvider | null = null;
  private formatterEnabled = false;
  private streamingSessions: Map<string, StreamingSession> = new Map();

  constructor(modelManagerService: ModelManagerService) {
    this.whisperProvider = new WhisperProvider(modelManagerService);
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
    audioChunk: Buffer;
    isFinal?: boolean;
  }): Promise<string> {
    const { sessionId, audioChunk, isFinal = false } = options;

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
      logger.transcription.info("Started streaming session", { sessionId });
    }

    // Process chunk if it has content
    if (audioChunk.length > 0) {
      // Direct provider call - no step wrapper
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
        context: {
          vocabulary: session.context.sharedData.vocabulary,
          accessibilityContext: session.context.sharedData.accessibilityContext,
          previousChunk,
          aggregatedTranscription: aggregatedTranscription || undefined,
        },
      });

      // Accumulate the result
      if (chunkTranscription.trim()) {
        session.transcriptionResults.push(chunkTranscription);
      }

      logger.transcription.debug("Processed chunk", {
        sessionId,
        chunkSize: audioChunk.length,
        transcriptionLength: chunkTranscription.length,
        totalResults: session.transcriptionResults.length,
        isFinal,
      });
    }

    // If this is the final chunk, apply formatting and save
    if (isFinal) {
      // Get complete transcription
      let completeTranscription = session.transcriptionResults.join(" ").trim();

      logger.transcription.info("Finalizing streaming session", {
        sessionId,
        rawTranscriptionLength: completeTranscription.length,
        chunkCount: session.transcriptionResults.length,
      });

      // Format if enabled
      if (this.formatterEnabled && this.openRouterProvider) {
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

      // Save directly to database
      await createTranscription({
        text: completeTranscription,
        language: session.context.sharedData.userPreferences?.language || "en",
        duration: session.context.sharedData.audioMetadata?.duration,
        speechModel: "whisper-local",
        formattingModel: this.formatterEnabled ? "openrouter" : undefined,
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
    return session.transcriptionResults.join(" ");
  }

  private async buildContext(): Promise<PipelineContext> {
    // Create default context
    const context = createDefaultContext(uuid());

    // Simple context building - no complex loading
    const serviceManager = ServiceManager.getInstance();
    if (serviceManager) {
      try {
        const settingsService = serviceManager.getSettingsService();
        const formatterConfig = await settingsService.getFormatterConfig();
      } catch (error) {
        logger.transcription.warn("Failed to load formatter config", { error });
      }
    }

    // TODO: Load actual vocabulary
    // TODO: Load user preferences from settings

    return context;
  }

  /**
   * Cleanup method
   */
  async dispose(): Promise<void> {
    await this.whisperProvider.dispose();
    logger.transcription.info("Transcription service disposed");
  }
}
