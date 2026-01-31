import {
  PipelineContext,
  StreamingPipelineContext,
  StreamingSession,
  TranscriptionProvider,
  FormattingProvider,
} from "../pipeline/core/pipeline-types";
import { createDefaultContext } from "../pipeline/core/context";
import { WhisperProvider } from "../pipeline/providers/transcription/whisper-provider";
import { AmicalCloudProvider } from "../pipeline/providers/transcription/amical-cloud-provider";
import { OpenRouterProvider } from "../pipeline/providers/formatting/openrouter-formatter";
import { OllamaFormatter } from "../pipeline/providers/formatting/ollama-formatter";
import { OpenAIFormatter } from "../pipeline/providers/formatting/openai-formatter";
import { AnthropicFormatter } from "../pipeline/providers/formatting/anthropic-formatter";
import { GoogleFormatter } from "../pipeline/providers/formatting/google-formatter";
import { ModelService } from "../services/model-service";
import { SettingsService } from "../services/settings-service";
import { TelemetryService } from "../services/telemetry-service";
import type { NativeBridge } from "./platform/native-bridge-service";
import type { OnboardingService } from "./onboarding-service";
import { createTranscription } from "../db/transcriptions";
import { getVocabulary } from "../db/vocabulary";
import { logger } from "../main/logger";
import { v4 as uuid } from "uuid";
import { VADService } from "./vad-service";
import { Mutex } from "async-mutex";
import { dialog } from "electron";
import { AVAILABLE_MODELS } from "../constants/models";

/**
 * Service for audio transcription and optional formatting
 */
export class TranscriptionService {
  private whisperProvider: WhisperProvider;
  private cloudProvider: AmicalCloudProvider;
  private currentProvider: TranscriptionProvider | null = null;
  private streamingSessions = new Map<string, StreamingSession>();
  private vadService: VADService | null;
  private settingsService: SettingsService;
  private vadMutex: Mutex;
  private transcriptionMutex: Mutex;
  private modelLoadMutex: Mutex;
  private telemetryService: TelemetryService;
  private modelService: ModelService;
  private modelWasPreloaded: boolean = false;

  constructor(
    modelService: ModelService,
    vadService: VADService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
    private nativeBridge: NativeBridge | null,
    private onboardingService: OnboardingService | null,
  ) {
    this.whisperProvider = new WhisperProvider(modelService);
    this.cloudProvider = new AmicalCloudProvider();
    this.vadService = vadService;
    this.settingsService = settingsService;
    this.vadMutex = new Mutex();
    this.transcriptionMutex = new Mutex();
    this.modelLoadMutex = new Mutex();
    this.telemetryService = telemetryService;
    this.modelService = modelService;
  }

  /**
   * Select the appropriate transcription provider based on the selected model
   */
  private async selectProvider(): Promise<TranscriptionProvider> {
    const selectedModelId = await this.modelService.getSelectedModel();

    if (!selectedModelId) {
      // Default to whisper if no model selected
      this.currentProvider = this.whisperProvider;
      return this.whisperProvider;
    }

    // Find the model in AVAILABLE_MODELS
    const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);

    // Use cloud provider for Amical Cloud models
    if (model?.provider === "Amical Cloud") {
      this.currentProvider = this.cloudProvider;
      return this.cloudProvider;
    }

    // Default to whisper for all other models
    this.currentProvider = this.whisperProvider;
    return this.whisperProvider;
  }

  async initialize(): Promise<void> {
    // Check if the selected model is a cloud model
    const selectedModelId = await this.modelService.getSelectedModel();
    const model = selectedModelId
      ? AVAILABLE_MODELS.find((m) => m.id === selectedModelId)
      : null;
    const isCloudModel = model?.provider === "Amical Cloud";

    // Only preload for local models
    if (!isCloudModel) {
      // Check if we should preload Whisper model
      const transcriptionSettings =
        await this.settingsService.getTranscriptionSettings();
      const shouldPreload =
        transcriptionSettings?.preloadWhisperModel !== false; // Default to true

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
          setTimeout(async () => {
            const onboardingCheck =
              await this.onboardingService?.checkNeedsOnboarding();
            if (!onboardingCheck?.needed) {
              dialog.showMessageBox({
                type: "warning",
                title: "No Transcription Models",
                message: "No transcription models are available.",
                detail:
                  "To use voice transcription, please download a model from Speech Models or use a cloud model.",
                buttons: ["OK"],
              });
            }
          }, 2000); // Delay to ensure windows are ready
        }
      } else {
        logger.transcription.info("Whisper model preloading disabled");
      }
    } else {
      logger.transcription.info(
        "Using cloud model - skipping local model preload",
      );
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
      // Check if selected model is a cloud model (doesn't need download)
      const selectedModelId = await this.modelService.getSelectedModel();
      if (selectedModelId) {
        const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId);
        if (model?.provider === "Amical Cloud") {
          return true;
        }
      }

      // For local models, check if any are downloaded
      const modelService = this.whisperProvider["modelService"];
      const availableModels = await modelService.getValidDownloadedModels();
      return Object.keys(availableModels).length > 0;
    } catch (error) {
      logger.transcription.error("Failed to check model availability:", error);
      return false;
    }
  }

  /**
   * Handle model change - load new model if preloading is enabled
   * Uses mutex to serialize concurrent model loads
   */
  async handleModelChange(): Promise<void> {
    this.modelLoadMutex.runExclusive(async () => {
      try {
        this.modelWasPreloaded = false;

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
                "Loading Whisper model after model change...",
              );
              await this.whisperProvider.preloadModel();
              this.modelWasPreloaded = true;
              logger.transcription.info("Whisper model loaded successfully");
            } else {
              logger.transcription.info("No models available to preload");
            }
          }
        }
      } catch (error) {
        logger.transcription.error("Failed to handle model change:", error);
        // Don't throw - model will be loaded on first use
      }
    });
  }

  /**
   * Process a single audio chunk in streaming mode
   * For finalization, use finalizeSession() instead
   */
  async processStreamingChunk(options: {
    sessionId: string;
    audioChunk: Float32Array;
    recordingStartedAt?: number;
  }): Promise<string> {
    const { sessionId, audioChunk, recordingStartedAt } = options;

    // Run VAD on the audio chunk
    let speechProbability = 0;
    let isSpeaking = false;

    if (audioChunk.length > 0 && this.vadService) {
      // Acquire VAD mutex
      await this.vadMutex.acquire();
      try {
        // Pass Float32Array directly to VAD
        const vadResult = await this.vadService.processAudioFrame(audioChunk);

        speechProbability = vadResult.probability;
        isSpeaking = vadResult.isSpeaking;
      } finally {
        // Release VAD mutex - always release even on error
        this.vadMutex.release();
      }

      logger.transcription.debug("VAD result", {
        probability: speechProbability.toFixed(3),
        isSpeaking,
      });
    }

    // Acquire transcription mutex
    await this.transcriptionMutex.acquire();

    // Auto-create session if it doesn't exist
    let session = this.streamingSessions.get(sessionId);

    try {
      if (!session) {
        const context = await this.buildContext();
        const streamingContext: StreamingPipelineContext = {
          ...context,
          sessionId,
          isPartial: true,
          isFinal: false,
          accumulatedTranscription: [],
        };

        // Get accessibility context from NativeBridge
        streamingContext.sharedData.accessibilityContext =
          this.nativeBridge?.getAccessibilityContext() ?? null;

        session = {
          context: streamingContext,
          transcriptionResults: [],
          firstChunkReceivedAt: performance.now(),
          recordingStartedAt: recordingStartedAt,
        };

        this.streamingSessions.set(sessionId, session);

        logger.transcription.info("Started streaming session", {
          sessionId,
        });
      }

      // Direct frame to Whisper - it will handle aggregation and VAD internally
      const previousChunk =
        session.transcriptionResults.length > 0
          ? session.transcriptionResults[
              session.transcriptionResults.length - 1
            ]
          : undefined;
      const aggregatedTranscription = session.transcriptionResults.join("");

      // Select the appropriate provider
      const provider = await this.selectProvider();

      // Transcribe chunk (flush is done separately in finalizeSession)
      const chunkTranscription = await provider.transcribe({
        audioData: audioChunk,
        speechProbability: speechProbability,
        context: {
          sessionId,
          vocabulary: session.context.sharedData.vocabulary,
          accessibilityContext: session.context.sharedData.accessibilityContext,
          previousChunk,
          aggregatedTranscription: aggregatedTranscription || undefined,
          language: session.context.sharedData.userPreferences?.language,
        },
      });

      // Accumulate the result only if Whisper returned something
      // (it returns empty string while buffering)
      if (chunkTranscription.trim()) {
        // Cloud provider concatenates previousTranscription with new transcription,
        // so we need to replace the array instead of appending to avoid duplication
        if (provider.name === "amical-cloud" && aggregatedTranscription) {
          session.transcriptionResults = [chunkTranscription];
        } else {
          session.transcriptionResults.push(chunkTranscription);
        }
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
      });
    } finally {
      // Release transcription mutex - always release even on error
      this.transcriptionMutex.release();
    }

    return session.transcriptionResults.join("");
  }

  /**
   * Cancel a streaming session without processing
   * Used when recording is cancelled (e.g., quick tap, accidental activation)
   */
  async cancelStreamingSession(sessionId: string): Promise<void> {
    if (this.streamingSessions.has(sessionId)) {
      // Acquire mutex to prevent race with processStreamingChunk
      await this.transcriptionMutex.acquire();
      try {
        // Clear provider buffers to prevent audio bleed into next session
        this.currentProvider?.reset();

        this.streamingSessions.delete(sessionId);
        logger.transcription.info("Streaming session cancelled", { sessionId });
      } finally {
        this.transcriptionMutex.release();
      }
    }
  }

  /**
   * Finalize a streaming session - flush provider, format, save to DB
   * Call this instead of processStreamingChunk with isFinal=true
   */
  async finalizeSession(options: {
    sessionId: string;
    audioFilePath?: string;
    recordingStartedAt?: number;
    recordingStoppedAt?: number;
  }): Promise<string> {
    const { sessionId, audioFilePath, recordingStartedAt, recordingStoppedAt } =
      options;

    const session = this.streamingSessions.get(sessionId);
    if (!session) {
      logger.transcription.warn("No session found to finalize", { sessionId });
      return "";
    }

    // Update session timestamps
    session.finalizationStartedAt = performance.now();
    session.recordingStoppedAt = recordingStoppedAt;
    if (recordingStartedAt && !session.recordingStartedAt) {
      session.recordingStartedAt = recordingStartedAt;
    }

    const formatterConfig = await this.settingsService.getFormatterConfig();
    const shouldUseCloudFormatting =
      formatterConfig?.enabled && formatterConfig.modelId === "amical-cloud";
    let usedCloudProvider = false;

    // Flush provider to get any remaining buffered audio
    await this.transcriptionMutex.acquire();
    try {
      const previousChunk =
        session.transcriptionResults.length > 0
          ? session.transcriptionResults[
              session.transcriptionResults.length - 1
            ]
          : undefined;
      const aggregatedTranscription = session.transcriptionResults.join("");

      const provider = await this.selectProvider();
      usedCloudProvider = provider.name === "amical-cloud";
      const finalTranscription = await provider.flush({
        sessionId,
        vocabulary: session.context.sharedData.vocabulary,
        accessibilityContext: session.context.sharedData.accessibilityContext,
        previousChunk,
        aggregatedTranscription: aggregatedTranscription || undefined,
        language: session.context.sharedData.userPreferences?.language,
        formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
      });

      if (finalTranscription.trim()) {
        // Cloud provider concatenates previousTranscription with new transcription,
        // so we need to replace the array instead of appending to avoid duplication
        if (usedCloudProvider && aggregatedTranscription) {
          session.transcriptionResults = [finalTranscription];
        } else {
          session.transcriptionResults.push(finalTranscription);
        }
        logger.transcription.info("Whisper returned final transcription", {
          sessionId,
          transcriptionLength: finalTranscription.length,
          totalResults: session.transcriptionResults.length,
        });
      }
    } finally {
      this.transcriptionMutex.release();
    }

    let completeTranscription = session.transcriptionResults.join("");

    // Apply simple pre-formatting for local models (handles Whisper leading space artifact)
    if (!usedCloudProvider) {
      const preSelectionText =
        session.context.sharedData.accessibilityContext?.context?.textSelection
          ?.preSelectionText;
      completeTranscription = this.preFormatLocalTranscription(
        completeTranscription,
        preSelectionText,
      );
    }

    let formattingDuration: number | undefined;

    logger.transcription.info("Finalizing streaming session", {
      sessionId,
      rawTranscriptionLength: completeTranscription.length,
      chunkCount: session.transcriptionResults.length,
    });

    // Fetch formatter config on-demand
    let formattingUsed = false;
    let formattingModel: string | undefined;

    if (!formatterConfig || !formatterConfig.enabled) {
      logger.transcription.debug("Formatting skipped: disabled in config");
    } else if (!completeTranscription.trim().length) {
      logger.transcription.debug("Formatting skipped: empty transcription");
    } else if (formatterConfig.modelId === "amical-cloud") {
      if (!usedCloudProvider) {
        logger.transcription.warn(
          "Formatting skipped: Amical Cloud formatting requires cloud transcription",
        );
      } else {
        formattingUsed = true;
        formattingModel = "amical-cloud";
      }
    } else {
      // Get default language model and look up provider
      const modelId =
        formatterConfig.modelId ||
        (await this.settingsService.getDefaultLanguageModel());
      if (!modelId) {
        logger.transcription.debug(
          "Formatting skipped: no default language model",
        );
      } else {
        const allModels = await this.modelService.getSyncedProviderModels();
        const model = allModels.find(
          (m) => m.id === modelId && m.type === "language",
        );

        if (!model) {
          logger.transcription.warn("Formatting skipped: model not found", {
            modelId,
          });
        } else if (model.provider === "OpenRouter") {
          const config = await this.settingsService.getOpenRouterConfig();
          if (!config?.apiKey) {
            logger.transcription.warn(
              "Formatting skipped: OpenRouter API key missing",
            );
          } else {
            logger.transcription.info("Starting formatting", {
              sessionId,
              provider: model.provider,
              model: modelId,
            });
            const provider = new OpenRouterProvider(config.apiKey, modelId);
            const result = await this.formatWithProvider(
              provider,
              sessionId,
              completeTranscription,
              session,
            );
            if (result) {
              completeTranscription = result.text;
              formattingDuration = result.duration;
              formattingUsed = true;
              formattingModel = modelId;
            }
          }
        } else if (model.provider === "Ollama") {
          const config = await this.settingsService.getOllamaConfig();
          if (!config?.url) {
            logger.transcription.warn("Formatting skipped: Ollama URL missing");
          } else {
            logger.transcription.info("Starting formatting", {
              sessionId,
              provider: model.provider,
              model: modelId,
            });
            const provider = new OllamaFormatter(config.url, modelId);
            const result = await this.formatWithProvider(
              provider,
              sessionId,
              completeTranscription,
              session,
            );
            if (result) {
              completeTranscription = result.text;
              formattingDuration = result.duration;
              formattingUsed = true;
              formattingModel = modelId;
            }
          }
        } else if (model.provider === "OpenAI") {
          const config = await this.settingsService.getOpenAIConfig();
          if (!config?.apiKey) {
            logger.transcription.warn(
              "Formatting skipped: OpenAI API key missing",
            );
          } else {
            logger.transcription.info("Starting formatting", {
              sessionId,
              provider: model.provider,
              model: modelId,
            });
            const provider = new OpenAIFormatter(config.apiKey, modelId);
            const result = await this.formatWithProvider(
              provider,
              sessionId,
              completeTranscription,
              session,
            );
            if (result) {
              completeTranscription = result.text;
              formattingDuration = result.duration;
              formattingUsed = true;
              formattingModel = modelId;
            }
          }
        } else if (model.provider === "Anthropic") {
          const config = await this.settingsService.getAnthropicConfig();
          if (!config?.apiKey) {
            logger.transcription.warn(
              "Formatting skipped: Anthropic API key missing",
            );
          } else {
            logger.transcription.info("Starting formatting", {
              sessionId,
              provider: model.provider,
              model: modelId,
            });
            const provider = new AnthropicFormatter(config.apiKey, modelId);
            const result = await this.formatWithProvider(
              provider,
              sessionId,
              completeTranscription,
              session,
            );
            if (result) {
              completeTranscription = result.text;
              formattingDuration = result.duration;
              formattingUsed = true;
              formattingModel = modelId;
            }
          }
        } else if (model.provider === "Google") {
          const config = await this.settingsService.getGoogleConfig();
          if (!config?.apiKey) {
            logger.transcription.warn(
              "Formatting skipped: Google API key missing",
            );
          } else {
            logger.transcription.info("Starting formatting", {
              sessionId,
              provider: model.provider,
              model: modelId,
            });
            const provider = new GoogleFormatter(config.apiKey, modelId);
            const result = await this.formatWithProvider(
              provider,
              sessionId,
              completeTranscription,
              session,
            );
            if (result) {
              completeTranscription = result.text;
              formattingDuration = result.duration;
              formattingUsed = true;
              formattingModel = modelId;
            }
          }
        } else {
          logger.transcription.warn(
            "Formatting skipped: unsupported provider",
            {
              provider: model.provider,
            },
          );
        }
      }
    }

    // Apply vocabulary replacements (final post-processing step)
    const replacements = session.context.sharedData.replacements;
    if (replacements.size > 0) {
      const beforeReplacements = completeTranscription;
      completeTranscription = this.applyReplacements(
        completeTranscription,
        replacements,
      );
      if (beforeReplacements !== completeTranscription) {
        logger.transcription.info("Applied vocabulary replacements", {
          sessionId,
          replacementCount: replacements.size,
          originalLength: beforeReplacements.length,
          newLength: completeTranscription.length,
        });
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
      formattingModel,
      audioFile: audioFilePath,
      meta: {
        sessionId,
        source: session.context.sharedData.audioMetadata?.source,
        vocabularySize: session.context.sharedData.vocabulary?.length || 0,
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

    const selectedModel = await this.modelService.getSelectedModel();
    const audioDurationSeconds =
      session.context.sharedData.audioMetadata?.duration;

    // Get native binding info if using local whisper
    let whisperNativeBinding: string | undefined;
    if (this.whisperProvider && "getBindingInfo" in this.whisperProvider) {
      const bindingInfo = await this.whisperProvider.getBindingInfo();
      whisperNativeBinding = bindingInfo?.type;
      logger.transcription.info(
        "whisper native binding used",
        whisperNativeBinding,
      );
    }

    this.telemetryService.trackTranscriptionCompleted({
      session_id: sessionId,
      model_id: selectedModel!,
      model_preloaded: this.modelWasPreloaded,
      whisper_native_binding: whisperNativeBinding,
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
      formatting_enabled: formattingUsed,
      formatting_model: formattingModel,
      formatting_duration_ms: formattingDuration,
      vad_enabled: !!this.vadService,
      session_type: "streaming",
      language: session.context.sharedData.userPreferences?.language || "en",
      vocabulary_size: session.context.sharedData.vocabulary?.length || 0,
    });

    this.streamingSessions.delete(sessionId);

    logger.transcription.info("Streaming session completed", { sessionId });
    return completeTranscription;
  }

  private async buildContext(): Promise<PipelineContext> {
    // Create default context
    const context = createDefaultContext(uuid());

    // Load dictation settings to get language preference
    const dictationSettings = await this.settingsService.getDictationSettings();
    if (dictationSettings) {
      context.sharedData.userPreferences.language =
        dictationSettings.autoDetectEnabled
          ? undefined
          : dictationSettings.selectedLanguage || "en";
    }

    // Load vocabulary and replacements
    const vocabEntries = await getVocabulary({ limit: 50 });
    for (const entry of vocabEntries) {
      if (entry.isReplacement) {
        context.sharedData.replacements.set(
          entry.word,
          entry.replacementWord || "",
        );
      } else {
        context.sharedData.vocabulary.push(entry.word);
      }
    }

    // TODO: Load formatter config from settings

    return context;
  }

  /**
   * Simple pre-formatter for local Transcription models.
   * Handles leading space based on insertion context to avoid double spaces or unwanted leading whitespace.
   * Runs before LLM formatter (if configured) to ensure clean input.
   */
  private preFormatLocalTranscription(
    transcription: string,
    preSelectionText: string | null | undefined,
  ): string {
    if (!transcription.startsWith(" ")) {
      return transcription;
    }

    // Strip leading space only if previous text exists and ends with ASCII whitespace.
    // When there's no previous text (null/undefined/""), keep the leading space.
    const shouldStripLeadingSpace =
      preSelectionText !== undefined &&
      preSelectionText !== null &&
      (preSelectionText.length === 0 || /[ \t\r\n]$/.test(preSelectionText));

    return shouldStripLeadingSpace ? transcription.slice(1) : transcription;
  }

  /**
   * Apply vocabulary replacements to transcription text.
   * Uses case-insensitive Unicode-aware word boundary matching to replace terms.
   * Works across all languages and scripts (Latin, Cyrillic, CJK, Arabic, etc.).
   * Runs after LLM formatting as the final post-processing step.
   */
  private applyReplacements(
    text: string,
    replacements: Map<string, string>,
  ): string {
    if (replacements.size === 0 || !text) {
      return text;
    }

    let result = text;

    for (const [word, replacement] of replacements) {
      // Escape special regex characters in the word
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Use Unicode-aware word boundaries:
      // - \p{L} matches any Unicode letter (Latin, Cyrillic, CJK, Arabic, etc.)
      // - \p{N} matches any Unicode number
      // - Negative lookbehind/lookahead ensures word is not part of a larger word
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapedWord}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      result = result.replace(regex, replacement);
    }

    return result;
  }

  private async formatWithProvider(
    provider: FormattingProvider,
    sessionId: string,
    text: string,
    session: StreamingSession,
  ): Promise<{ text: string; duration: number } | null> {
    const startTime = performance.now();
    const style = session.context.sharedData.userPreferences?.formattingStyle;

    try {
      const formattedText = await provider.format({
        text,
        context: {
          style,
          vocabulary: session.context.sharedData.vocabulary,
          accessibilityContext: session.context.sharedData.accessibilityContext,
          previousChunk:
            session.transcriptionResults.length > 1
              ? session.transcriptionResults[
                  session.transcriptionResults.length - 2
                ]
              : undefined,
          aggregatedTranscription: text,
        },
      });

      const duration = performance.now() - startTime;

      logger.transcription.info("Text formatted successfully", {
        sessionId,
        originalLength: text.length,
        formattedLength: formattedText.length,
        formattingDuration: duration,
      });

      return { text: formattedText, duration };
    } catch (error) {
      logger.transcription.error("Formatting failed, using unformatted text", {
        sessionId,
        error,
      });
      return null;
    }
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
