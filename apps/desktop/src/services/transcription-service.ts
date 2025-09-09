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
import { TelemetryService } from "../services/telemetry-service";
import { createTranscription } from "../db/transcriptions";
import { logger } from "../main/logger";
import { v4 as uuid } from "uuid";
import { VADService } from "./vad-service";
import { Mutex } from "async-mutex";
import { app, dialog } from "electron";

/**
 * Service for audio transcription and optional formatting
 */
export class TranscriptionService {
  private whisperProvider: WhisperProvider;
  private openRouterProvider: OpenRouterProvider | null = null;
  private formatterEnabled = false;
  private streamingSessions = new Map<string, StreamingSession>();
  private vadService: VADService | null;
  private settingsService: SettingsService;
  private vadMutex: Mutex;
  private transcriptionMutex: Mutex;
  private telemetryService: TelemetryService;
  private modelManagerService: ModelManagerService;
  private modelWasPreloaded: boolean = false;

  constructor(
    modelManagerService: ModelManagerService,
    vadService: VADService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ) {
    this.whisperProvider = new WhisperProvider(modelManagerService);
    this.vadService = vadService;
    this.settingsService = settingsService;
    this.vadMutex = new Mutex();
    this.transcriptionMutex = new Mutex();
    this.telemetryService = telemetryService;
    this.modelManagerService = modelManagerService;
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
      // Check if models are available for preloading
      const hasModels = await this.isModelAvailable();
      if (hasModels) {
        logger.transcription.info("Preloading Whisper model...");
        await this.preloadWhisperModel();
        this.modelWasPreloaded = true;
        logger.transcription.info("Whisper model preloaded successfully");
      } else {
        logger.transcription.info(
          "Whisper model preloading skipped - no models available",
        );
        if (app.isReady()) {
          setTimeout(() => {
            dialog.showMessageBox({
              type: "warning",
              title: "No Transcription Models",
              message: "No transcription models are available.",
              detail:
                "To use voice transcription, please download a model from Speech Models.",
              buttons: ["OK"],
            });
          }, 2000); // Delay to ensure windows are ready
        }
      }
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
   * Check if transcription models are available (real-time check)
   */
  public async isModelAvailable(): Promise<boolean> {
    try {
      const modelManager = this.whisperProvider["modelManager"];
      const availableModels = await modelManager.getValidDownloadedModels();
      return Object.keys(availableModels).length > 0;
    } catch (error) {
      logger.transcription.error("Failed to check model availability:", error);
      return false;
    }
  }

  /**
   * Handle model change - dispose old model and load new one if preloading is enabled
   */
  async handleModelChange(): Promise<void> {
    try {
      // Dispose current model
      await this.whisperProvider.dispose();
      this.modelWasPreloaded = false; // Reset preload flag on model change

      // Check if preloading is enabled and models are available
      if (this.settingsService) {
        const transcriptionSettings =
          await this.settingsService.getTranscriptionSettings();
        const shouldPreload =
          transcriptionSettings?.preloadWhisperModel !== false;

        if (shouldPreload) {
          const hasModels = await this.isModelAvailable();
          if (hasModels) {
            logger.transcription.info(
              "Reloading Whisper model after model change...",
            );
            await this.whisperProvider.preloadModel();
            this.modelWasPreloaded = true;
            logger.transcription.info("Whisper model reloaded successfully");
          } else {
            logger.transcription.info("No models available to preload");
          }
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
    recordingStartedAt?: number;
    recordingStoppedAt?: number;
  }): Promise<string> {
    const {
      sessionId,
      audioChunk,
      isFinal = false,
      audioFilePath,
      recordingStartedAt,
      recordingStoppedAt,
    } = options;

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
        firstChunkReceivedAt: performance.now(),
        recordingStartedAt: recordingStartedAt, // From RecordingManager (when user pressed record)
      };

      this.streamingSessions.set(sessionId, session);

      logger.transcription.info("Started streaming session", {
        sessionId,
      });
    }

    // Direct frame to Whisper - it will handle aggregation and VAD internally
    const previousChunk =
      session.transcriptionResults.length > 0
        ? session.transcriptionResults[session.transcriptionResults.length - 1]
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

    // Release transcription mutex
    this.transcriptionMutex.release();
    const completeTranscriptionTillNow = session.transcriptionResults
      .join(" ")
      .trim();

    // this is the final chunk, save the transcription
    if (!isFinal) {
      return completeTranscriptionTillNow;
    }

    session.finalChunkReceivedAt = performance.now();
    session.recordingStoppedAt = recordingStoppedAt;

    let completeTranscription = completeTranscriptionTillNow;
    let formattingStartTime: number | undefined;
    let formattingDuration: number | undefined;

    logger.transcription.info("Finalizing streaming session", {
      sessionId,
      rawTranscriptionLength: completeTranscription.length,
      chunkCount: session.transcriptionResults.length,
    });

    if (
      this.formatterEnabled &&
      this.openRouterProvider &&
      completeTranscription.trim().length
    ) {
      try {
        formattingStartTime = performance.now();
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

        formattingDuration = performance.now() - formattingStartTime;

        logger.transcription.info("Text formatted successfully", {
          sessionId,
          originalTranscription: completeTranscription,
          formattedTranscription: formattedText,
          originalLength: completeTranscription.length,
          formattedLength: formattedText.length,
          formattingDuration,
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

    // Track transcription completion
    const completionTime = performance.now();

    // Calculate durations:
    // - Recording duration: from when recording started to when it ended
    // - Processing duration: from when recording ended to completion
    // - Total duration: from recording start to completion
    const recordingDuration =
      session.recordingStartedAt && session.recordingStoppedAt
        ? session.recordingStoppedAt - session.recordingStartedAt
        : undefined;
    const processingDuration = session.recordingStoppedAt
      ? completionTime - session.recordingStoppedAt
      : undefined;
    const totalDuration = session.recordingStartedAt
      ? completionTime - session.recordingStartedAt
      : undefined;

    const selectedModel =
      this.modelManagerService.getSelectedModel() || "unknown";
    const audioDurationSeconds =
      session.context.sharedData.audioMetadata?.duration;

    this.telemetryService.trackTranscriptionCompleted({
      session_id: sessionId,
      model_id: selectedModel,
      model_preloaded: this.modelWasPreloaded,
      total_duration_ms: totalDuration || 0,
      recording_duration_ms: recordingDuration,
      processing_duration_ms: processingDuration,
      audio_duration_seconds: audioDurationSeconds,
      realtime_factor:
        audioDurationSeconds && totalDuration
          ? audioDurationSeconds / (totalDuration / 1000)
          : undefined,
      text_length: completeTranscription.length,
      word_count: completeTranscription.trim().split(/\s+/).length,
      formatting_enabled: this.formatterEnabled,
      formatting_model: this.formatterEnabled ? "openrouter" : undefined,
      formatting_duration_ms: formattingDuration,
      vad_enabled: !!this.vadService,
      session_type: "streaming",
      language: session.context.sharedData.userPreferences?.language || "en",
      vocabulary_size: session.context.sharedData.vocabulary?.size || 0,
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
