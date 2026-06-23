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
import { createRemoteFormattingProvider } from "../pipeline/providers/formatting/remote-formatting-provider-registry";
import type { RemoteFormattingProviderType } from "../pipeline/providers/formatting/remote-formatting-provider-registry";
import { ModelService } from "../services/model-service";
import { SettingsService } from "../services/settings-service";
import { TelemetryService } from "../services/telemetry-service";
import type { NativeBridge } from "./platform/native-bridge-service";
import type { OnboardingService } from "./onboarding-service";
import {
  createTranscription,
  getTranscriptionById,
  updateTranscription,
} from "../db/transcriptions";
import { incrementDailyStats } from "../db/daily-stats";
import { getAllVocabulary } from "../db/vocabulary";
import { getAllSnippets } from "../db/snippets";
import { logger } from "../main/logger";
import { v4 as uuid } from "uuid";
import { VADService } from "./vad-service";
import { Mutex } from "async-mutex";
import { dialog } from "electron";
import { AVAILABLE_MODELS } from "../constants/models";
import { AppError, ErrorCodes } from "../types/error";
import { applyTextReplacements } from "../utils/text-replacement";
import { normalizeTranscriptionBoundaries } from "../utils/boundary-spacing";
import { selectVocabularyHints } from "../utils/vocabulary-hints";
import * as fs from "node:fs";
import { PROVIDER_TYPES } from "../constants/provider-types";
import {
  findModelBySelectionValue,
  getModelSelectionKey,
  getSpeechModelSelectionKey,
  isAmicalCloudSelectionValue,
} from "../utils/model-selection";
import { countWords } from "../utils/dictation-stats";

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
  private loggedVadFallback = false;

  constructor(
    modelService: ModelService,
    vadService: VADService,
    settingsService: SettingsService,
    telemetryService: TelemetryService,
    private nativeBridge: NativeBridge | null,
    private onboardingService: OnboardingService | null,
  ) {
    this.whisperProvider = new WhisperProvider(modelService);
    this.cloudProvider = new AmicalCloudProvider(
      telemetryService,
      settingsService,
    );
    this.vadService = vadService;
    this.settingsService = settingsService;
    this.vadMutex = new Mutex();
    this.transcriptionMutex = new Mutex();
    this.modelLoadMutex = new Mutex();
    this.telemetryService = telemetryService;
    this.modelService = modelService;
  }

  /**
   * Warm the active provider in advance of a session so first-chunk latency
   * doesn't include model load (whisper) or token refresh (cloud).
   * Idempotent and cheap when already warm. Safe to fire-and-forget.
   */
  async warmupActiveProvider(): Promise<void> {
    const provider = await this.selectProvider();
    await provider.warmup?.();
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
      // Cloud model selected: warm auth so the first dictation's first chunk
      // doesn't block on a token-refresh roundtrip.
      try {
        await this.cloudProvider.warmup?.();
        logger.transcription.info("Cloud auth warmed up");
      } catch (error) {
        logger.transcription.warn("Cloud auth warmup failed (non-fatal)", {
          error,
        });
      }
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
    isInstruct?: boolean;
  }): Promise<string> {
    const { sessionId, audioChunk, recordingStartedAt, isInstruct } = options;

    // Run VAD on the audio chunk
    let speechProbability = this.vadService ? 0 : 1;
    let isSpeaking = !this.vadService && audioChunk.length > 0;

    if (audioChunk.length > 0 && !this.vadService && !this.loggedVadFallback) {
      logger.transcription.warn(
        "VAD unavailable; defaulting speechProbability to 1.0 for streaming chunks",
      );
      this.loggedVadFallback = true;
    }

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
        const formatterConfig = await this.settingsService.getFormatterConfig();
        streamingContext.metadata.set(
          "cloudFormattingEnabled",
          !!(
            formatterConfig?.enabled &&
            isAmicalCloudSelectionValue(formatterConfig.modelId)
          ),
        );
        // Instruct rides the per-session metadata (like cloudFormattingEnabled)
        // so it persists across chunks and into finalize. Drives the "instruct"
        // preset sent to the cloud at stream open.
        streamingContext.metadata.set("isInstruct", !!isInstruct);

        // Get accessibility context from NativeBridge
        streamingContext.sharedData.accessibilityContext =
          this.nativeBridge?.getAccessibilityContext() ?? null;

        session = {
          context: streamingContext,
          transcriptionResults: [],
          firstChunkReceivedAt: performance.now(),
          recordingStartedAt: recordingStartedAt,
          abortController: new AbortController(),
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
      const chunkResult = await provider.transcribe({
        audioData: audioChunk,
        speechProbability: speechProbability,
        context: {
          sessionId,
          vocabulary: session.context.sharedData.vocabulary,
          accessibilityContext: session.context.sharedData.accessibilityContext,
          previousChunk,
          aggregatedTranscription: aggregatedTranscription || undefined,
          languages: session.context.sharedData.userPreferences?.languages,
          formattingEnabled:
            session.context.metadata.get("cloudFormattingEnabled") === true,
          isInstruct: session.context.metadata.get("isInstruct") === true,
        },
      });
      session.detectedLanguage = this.mergeDetectedLanguage(
        session.detectedLanguage,
        chunkResult.detectedLanguage,
      );

      // Accumulate the result only if Whisper returned something
      // (it returns empty string while buffering)
      this.accumulateTranscriptionResult(
        session.transcriptionResults,
        chunkResult.text,
        provider.name === "amical-cloud",
      );
      if (chunkResult.text.trim()) {
        logger.transcription.info("Whisper returned transcription", {
          sessionId,
          transcriptionLength: chunkResult.text.length,
          totalResults: session.transcriptionResults.length,
        });
      }

      logger.transcription.debug("Processed frame", {
        sessionId,
        frameSize: audioChunk.length,
        hadTranscription: chunkResult.text.length > 0,
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
   * Dismiss a session by aborting its signal. This both (a) flags
   * finalizeSession's cooperative gates so it writes a dismissed row instead of
   * pasting, and (b) cancels an in-flight flush: flush() reacts to the abort by
   * calling provider.reset(), which synchronously cancels the gRPC stream /
   * aborts the HTTP fetch off the transcription mutex, rejecting the awaited
   * flush so the recording machine returns to idle immediately. No-op effect for
   * the local whisper worker (an in-flight decode isn't interruptible) — its
   * cooperative checkpoints discard the result. No-op if the session is already
   * gone (nothing left to dismiss).
   */
  abortSession(sessionId: string): void {
    const session = this.streamingSessions.get(sessionId);
    if (!session) {
      return;
    }
    session.abortController.abort();
    logger.transcription.info("Aborted session", { sessionId });
  }

  /**
   * The control signal finalizeSession throws on dismiss. A fresh instance per
   * throw so the stack trace points at the actual throw site.
   */
  private userDismissedError(): AppError {
    return new AppError("Recording dismissed", ErrorCodes.USER_DISMISSED);
  }

  /**
   * Persist a dismissed dictation: empty text, the captured audio (if any), and
   * meta.status="dismissed". No stats increment (the user deliberately discarded).
   */
  async saveDismissedTranscription(options: {
    sessionId: string;
    audioFilePath?: string;
  }): Promise<void> {
    await createTranscription({
      text: "",
      audioFile: options.audioFilePath,
      meta: {
        sessionId: options.sessionId,
        status: "dismissed",
      },
    });
    logger.transcription.info("Saved dismissed transcription record", {
      sessionId: options.sessionId,
      audioFilePath: options.audioFilePath,
    });
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
    // The session's aborter — its signal drives every dismiss gate below and is
    // handed to provider.flush() so a dismiss can cancel the in-flight call.
    const { signal } = session.abortController;

    try {
      // Early dismiss: the user dismissed before the flush started — skip the
      // flush entirely (no wasted transcription call). The catch below persists
      // the dismissed row once and rethrows USER_DISMISSED.
      if (signal.aborted) {
        throw this.userDismissedError();
      }

      // Update session timestamps
      session.finalizationStartedAt = performance.now();
      session.recordingStoppedAt = recordingStoppedAt;
      if (recordingStartedAt && !session.recordingStartedAt) {
        session.recordingStartedAt = recordingStartedAt;
      }

      const formatterConfig = await this.settingsService.getFormatterConfig();
      const shouldUseCloudFormatting =
        formatterConfig?.enabled &&
        isAmicalCloudSelectionValue(formatterConfig.modelId);
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
        const finalResult = await provider.flush(
          {
            sessionId,
            vocabulary: session.context.sharedData.vocabulary,
            accessibilityContext:
              session.context.sharedData.accessibilityContext,
            previousChunk,
            aggregatedTranscription: aggregatedTranscription || undefined,
            languages: session.context.sharedData.userPreferences?.languages,
            formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
            isInstruct: session.context.metadata.get("isInstruct") === true,
          },
          signal,
        );
        session.detectedLanguage = this.mergeDetectedLanguage(
          session.detectedLanguage,
          finalResult.detectedLanguage,
        );

        this.accumulateTranscriptionResult(
          session.transcriptionResults,
          finalResult.text,
          usedCloudProvider,
        );
        if (finalResult.text.trim()) {
          logger.transcription.info("Whisper returned final transcription", {
            sessionId,
            transcriptionLength: finalResult.text.length,
            totalResults: session.transcriptionResults.length,
          });
        }
      } finally {
        this.transcriptionMutex.release();
      }

      const rawTranscription = session.transcriptionResults.join("");

      logger.transcription.info("Finalizing streaming session", {
        sessionId,
        rawTranscriptionLength: rawTranscription.length,
        chunkCount: session.transcriptionResults.length,
      });

      // Finalize-phase dismiss: the flush already ran, but the user dismissed.
      // Discard the transcript — the catch below persists the dismissed row and
      // rethrows USER_DISMISSED (skip paste/stats).
      if (signal.aborted) {
        throw this.userDismissedError();
      }

      const requestedLanguage = this.singleRequestedLanguage(
        session.context.sharedData.userPreferences?.languages,
      );
      const detectedLanguage = this.sanitizeDetectedLanguage(
        session.detectedLanguage,
      );

      const formatResult = await this.applyFormattingAndReplacements({
        text: rawTranscription,
        usedCloudProvider,
        vocabulary: session.context.sharedData.vocabulary,
        accessibilityContext: session.context.sharedData.accessibilityContext,
        replacements: session.context.sharedData.replacements,
        formattingStyle:
          session.context.sharedData.userPreferences?.formattingStyle,
      });
      // Final post-format pass: normalize boundary whitespace based on the
      // insertion context. Runs after formatting + replacements so the emitted
      // text (raw or formatted) is normalized, matching the cloud server's
      // server-side handling. Cloud transcripts are already normalized there.
      const textSelection =
        session.context.sharedData.accessibilityContext?.context?.textSelection;
      const completeTranscription = usedCloudProvider
        ? formatResult.text
        : normalizeTranscriptionBoundaries(
            formatResult.text,
            textSelection?.preSelectionText,
            textSelection?.postSelectionText,
          );
      const transcriptionWordCount = countWords(
        formatResult.textBeforeReplacements,
        detectedLanguage ?? requestedLanguage,
      );
      const formattingUsed = formatResult.formattingUsed;
      const formattingModel = formatResult.formattingModel;
      const formattingDuration = formatResult.formattingDuration;

      // Save directly to database
      logger.transcription.info("Saving transcription with audio file", {
        sessionId,
        audioFilePath,
        hasAudioFile: !!audioFilePath,
      });

      const selectedModelId = await this.modelService.getSelectedModel();
      const speechModelId = usedCloudProvider
        ? "amical-cloud"
        : selectedModelId || "whisper-local";

      // Late dismiss: the user dismissed while formatting / model lookup was in
      // flight (after the post-flush check). Discard the now-formatted transcript
      // — the catch persists the dismissed row and rethrows USER_DISMISSED, so
      // there's no paste, no stats, no completion telemetry.
      //
      // This is the FINAL dismiss gate. A dismiss arriving after this point
      // (during the DB write / return / the caller's paste) is an accepted
      // single-ms race we deliberately do NOT guard: the transcription has
      // effectively committed, and once handleFinalChunk hands the text to the
      // native paste there is nothing left to abort. See handleFinalChunk.
      if (signal.aborted) {
        throw this.userDismissedError();
      }

      await createTranscription({
        text: completeTranscription,
        language: requestedLanguage,
        detectedLanguage,
        duration: session.context.sharedData.audioMetadata?.duration,
        speechModel: speechModelId,
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

      try {
        await incrementDailyStats(transcriptionWordCount);
      } catch (error) {
        logger.transcription.error("Failed to increment dictation stats", {
          sessionId,
          error,
        });
      }

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
        model_id: speechModelId,
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
        word_count: transcriptionWordCount,
        formatting_enabled: formattingUsed,
        formatting_model: formattingModel,
        formatting_duration_ms: formattingDuration,
        vad_enabled: !!this.vadService,
        languages: session.context.sharedData.userPreferences?.languages ?? [],
        vocabulary_size: session.context.sharedData.vocabulary?.length || 0,
      });

      this.streamingSessions.delete(sessionId);

      logger.transcription.info("Streaming session completed", { sessionId });
      return completeTranscription;
    } catch (error) {
      // Dismiss — either an aborted flush, or the USER_DISMISSED rethrown from
      // the pre/post-flush checks above. Persist the dismissed row once (with the
      // already-written audio) and rethrow USER_DISMISSED so the caller resets
      // silently — no failure toast.
      if (signal.aborted) {
        await this.saveDismissedTranscription({
          sessionId,
          audioFilePath: audioFilePath || undefined,
        });
        this.streamingSessions.delete(sessionId);
        logger.transcription.info("Dismissed transcription during finalize", {
          sessionId,
        });
        throw this.userDismissedError();
      }

      // Save failed transcription record
      const errorCode =
        error instanceof AppError ? error.errorCode : ErrorCodes.UNKNOWN;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await createTranscription({
        text: "",
        audioFile: audioFilePath || undefined,
        language: this.singleRequestedLanguage(
          session.context.sharedData.userPreferences?.languages,
        ),
        detectedLanguage: this.sanitizeDetectedLanguage(
          session.detectedLanguage,
        ),
        meta: {
          sessionId,
          status: "failed",
          failureReason: errorCode,
          errorMessage,
        },
      });
      logger.transcription.info("Saved failed transcription record", {
        sessionId,
        errorCode,
        audioFilePath,
      });

      try {
        // Failed rows still appear in History, so they intentionally contribute
        // to totalTranscriptions even though they add zero dictated words.
        await incrementDailyStats(0);
      } catch (statsError) {
        logger.transcription.error(
          "Failed to increment failed dictation stats",
          {
            sessionId,
            error: statsError,
          },
        );
      }

      // Clean up session
      this.streamingSessions.delete(sessionId);

      // Re-throw for RecordingManager to handle notifications
      throw error;
    }
  }

  private async buildContext(): Promise<PipelineContext> {
    // Create default context
    const context = createDefaultContext(uuid());

    // Load dictation settings. Auto-detect (or no languages selected) means no
    // language constraint; otherwise pass the selected languages through.
    const dictationSettings = await this.settingsService.getDictationSettings();
    const languages = dictationSettings.languages ?? [];
    context.sharedData.userPreferences.languages =
      dictationSettings.autoDetectEnabled || languages.length === 0
        ? undefined
        : languages;

    // Load vocabulary — every entry the user has authored should participate
    // in replacement; caps belong on the create path, not here.
    const vocabEntries = await getAllVocabulary();
    for (const entry of vocabEntries) {
      if (entry.isReplacement) {
        context.sharedData.replacements.set(
          entry.word,
          entry.replacementWord || "",
        );
      }
    }
    // Non-replacement vocabulary is sent to the LLM formatter as hints; the
    // hint list is capped separately from storage so the prompt stays bounded.
    context.sharedData.vocabulary.push(...selectVocabularyHints(vocabEntries));

    // Load snippets — trigger phrases that expand into longer content.
    // Snippets piggy-back on the same replacement pipeline as vocabulary replacements.
    const snippetEntries = await getAllSnippets();
    for (const snippet of snippetEntries) {
      context.sharedData.replacements.set(snippet.trigger, snippet.content);
    }

    // TODO: Load formatter config from settings

    return context;
  }

  private async formatWithProvider(
    provider: FormattingProvider,
    text: string,
    context: {
      style?: string;
      vocabulary?: string[];
      accessibilityContext?: StreamingSession["context"]["sharedData"]["accessibilityContext"];
    },
  ): Promise<{ text: string; duration: number } | null> {
    const startTime = performance.now();

    try {
      const formattedText = await provider.format({
        text,
        context: {
          style: context.style,
          vocabulary: context.vocabulary,
          accessibilityContext: context.accessibilityContext,
          aggregatedTranscription: text,
        },
      });

      const duration = performance.now() - startTime;

      logger.transcription.info("Text formatted successfully", {
        originalLength: text.length,
        formattedLength: formattedText.length,
        formattingDuration: duration,
      });

      return { text: formattedText, duration };
    } catch (error) {
      logger.transcription.error("Formatting failed, using unformatted text", {
        error,
      });
      return null;
    }
  }

  /**
   * Shared formatting and vocabulary replacement logic used by both
   * finalizeSession and retryTranscription.
   */
  private async applyFormattingAndReplacements(options: {
    text: string;
    usedCloudProvider: boolean;
    vocabulary?: string[];
    accessibilityContext?: StreamingSession["context"]["sharedData"]["accessibilityContext"];
    replacements: Map<string, string>;
    formattingStyle?: string;
  }): Promise<{
    text: string;
    textBeforeReplacements: string;
    formattingUsed: boolean;
    formattingModel?: string;
    formattingDuration?: number;
  }> {
    let text = options.text;
    let formattingUsed = false;
    let formattingModel: string | undefined;
    let formattingDuration: number | undefined;

    const formatterConfig = await this.settingsService.getFormatterConfig();

    if (!formatterConfig || !formatterConfig.enabled) {
      logger.transcription.debug("Formatting skipped: disabled in config");
    } else if (!text.trim().length) {
      logger.transcription.debug("Formatting skipped: empty transcription");
    } else if (isAmicalCloudSelectionValue(formatterConfig.modelId)) {
      if (!options.usedCloudProvider) {
        logger.transcription.warn(
          "Formatting skipped: Amical Cloud formatting requires cloud transcription",
        );
      } else {
        formattingUsed = true;
        formattingModel = getSpeechModelSelectionKey("amical-cloud");
      }
    } else {
      const modelId =
        formatterConfig.modelId ||
        (await this.settingsService.getDefaultLanguageModel());
      if (!modelId) {
        logger.transcription.debug(
          "Formatting skipped: no default language model",
        );
      } else {
        const allModels = await this.modelService.getSyncedProviderModels();
        const model = findModelBySelectionValue(
          allModels.filter((entry) => entry.type === "language"),
          modelId,
        );

        if (!model) {
          logger.transcription.warn("Formatting skipped: model not found", {
            modelId,
          });
        } else if (model.providerType !== PROVIDER_TYPES.localWhisper) {
          const provider = await createRemoteFormattingProvider(
            this.settingsService,
            model.providerType as RemoteFormattingProviderType,
            model.id,
          );

          if (!provider) {
            logger.transcription.warn(
              "Formatting skipped: provider config missing",
              {
                provider: model.provider,
              },
            );
          } else {
            logger.transcription.info("Starting formatting", {
              provider: model.provider,
              model: model.id,
            });
            const result = await this.formatWithProvider(provider, text, {
              style: options.formattingStyle,
              vocabulary: options.vocabulary,
              accessibilityContext: options.accessibilityContext,
            });
            if (result) {
              text = result.text;
              formattingDuration = result.duration;
              formattingUsed = true;
              formattingModel = getModelSelectionKey(
                model.providerInstanceId,
                model.type,
                model.id,
              );
            }
          }
        } else {
          logger.transcription.warn(
            "Formatting skipped: unsupported provider",
            { provider: model.provider },
          );
        }
      }
    }

    const textBeforeReplacements = text;

    // Apply vocabulary replacements (final post-processing step)
    if (options.replacements.size > 0) {
      const beforeReplacements = text;
      text = applyTextReplacements(text, options.replacements);
      if (beforeReplacements !== text) {
        logger.transcription.info("Applied vocabulary replacements", {
          replacementCount: options.replacements.size,
          originalLength: beforeReplacements.length,
          newLength: text.length,
        });
      }
    }

    return {
      text,
      textBeforeReplacements,
      formattingUsed,
      formattingModel,
      formattingDuration,
    };
  }

  /**
   * Read a WAV file from disk and return Float32Array of PCM samples.
   * Assumes standard 44-byte WAV header with Int16 PCM data (our app's format).
   */
  private async readWavAsFloat32(filePath: string): Promise<Float32Array> {
    const fileBuffer = await fs.promises.readFile(filePath);
    const WAV_HEADER_SIZE = 44;
    const pcmData = fileBuffer.subarray(WAV_HEADER_SIZE);
    const int16Array = new Int16Array(
      pcmData.buffer,
      pcmData.byteOffset,
      pcmData.byteLength / 2,
    );
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }
    return float32Array;
  }

  /**
   * Retry transcription for an existing record using current model and settings.
   * Bypasses RecordingManager entirely — works directly with providers.
   */
  async retryTranscription(transcriptionId: number): Promise<string> {
    const retryStartedAt = performance.now();

    // Guard: reject if a recording session is active
    if (this.streamingSessions.size > 0) {
      throw new Error("Cannot retry while recording is in progress");
    }

    // Fetch the existing transcription record
    const record = await getTranscriptionById(transcriptionId);
    if (!record) {
      throw new Error("Transcription not found");
    }

    if (!record.audioFile) {
      throw new Error("No audio file associated with this transcription");
    }

    // Verify the audio file exists on disk
    await fs.promises.access(record.audioFile);

    // Read WAV file into Float32Array
    const audioData = await this.readWavAsFloat32(record.audioFile);

    // Build fresh context for vocabulary, language, and replacements
    const context = await this.buildContext();
    const retrySessionId = context.sessionId;
    const vocabulary = context.sharedData.vocabulary;
    const languages = context.sharedData.userPreferences?.languages;
    const language = this.singleRequestedLanguage(languages);

    // Determine formatting config before acquiring mutex
    const selectedModelId = await this.modelService.getSelectedModel();
    const formatterConfig = await this.settingsService.getFormatterConfig();
    const shouldUseCloudFormatting =
      formatterConfig?.enabled &&
      isAmicalCloudSelectionValue(formatterConfig.modelId);

    // Split audio into 512-sample frames for per-frame VAD
    const FRAME_SIZE = 512;
    const frames: Float32Array[] = [];
    for (let offset = 0; offset < audioData.length; offset += FRAME_SIZE) {
      frames.push(
        audioData.subarray(
          offset,
          Math.min(offset + FRAME_SIZE, audioData.length),
        ),
      );
    }

    // Compute per-frame VAD probabilities (batch under one vadMutex acquisition)
    const vadProbs: number[] = [];
    if (this.vadService) {
      await this.vadMutex.runExclusive(async () => {
        this.vadService!.reset();
        for (const frame of frames) {
          const result = await this.vadService!.processAudioFrame(frame);
          vadProbs.push(result.probability);
        }
      });
    } else {
      vadProbs.push(...new Array(frames.length).fill(1));
    }

    logger.transcription.info("Starting transcription retry", {
      transcriptionId,
      sessionId: retrySessionId,
      audioFile: record.audioFile,
      audioSamples: audioData.length,
      totalFrames: frames.length,
    });

    // Transcribe using current provider settings
    const transcriptionResults: string[] = [];
    let detectedLanguage = this.sanitizeDetectedLanguage(
      record.detectedLanguage,
    );
    let usedCloudProvider = false;

    await this.transcriptionMutex.acquire();
    try {
      const provider = await this.selectProvider();
      usedCloudProvider = provider.name === "amical-cloud";
      provider.reset();

      // Feed each frame with its computed VAD probability
      for (let i = 0; i < frames.length; i++) {
        const previousChunk =
          transcriptionResults.length > 0
            ? transcriptionResults[transcriptionResults.length - 1]
            : undefined;
        const aggregatedTranscription = transcriptionResults.join("");

        const chunkResult = await provider.transcribe({
          audioData: frames[i],
          speechProbability: vadProbs[i],
          context: {
            sessionId: retrySessionId,
            vocabulary,
            languages,
            previousChunk,
            aggregatedTranscription: aggregatedTranscription || undefined,
            formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
          },
        });
        detectedLanguage = this.mergeDetectedLanguage(
          detectedLanguage,
          chunkResult.detectedLanguage,
        );

        this.accumulateTranscriptionResult(
          transcriptionResults,
          chunkResult.text,
          usedCloudProvider,
        );
      }

      // Flush to get remaining buffered audio
      const aggregatedTranscription = transcriptionResults.join("");
      const finalResult = await provider.flush({
        sessionId: retrySessionId,
        vocabulary,
        languages,
        aggregatedTranscription: aggregatedTranscription || undefined,
        formattingEnabled: shouldUseCloudFormatting && usedCloudProvider,
      });
      detectedLanguage = this.mergeDetectedLanguage(
        detectedLanguage,
        finalResult.detectedLanguage,
      );

      this.accumulateTranscriptionResult(
        transcriptionResults,
        finalResult.text,
        usedCloudProvider,
      );
    } finally {
      this.transcriptionMutex.release();
    }

    const rawTranscription = transcriptionResults.join("");

    // Apply formatting and vocabulary replacements
    const formatResult = await this.applyFormattingAndReplacements({
      text: rawTranscription,
      usedCloudProvider,
      vocabulary,
      replacements: context.sharedData.replacements,
      formattingStyle: context.sharedData.userPreferences?.formattingStyle,
    });

    // Final post-format pass, mirroring finalizeSession. Re-transcription has no
    // insertion context (accessibility context is not threaded through here), so
    // normalize without surrounding text. Cloud transcripts are already
    // normalized server-side.
    const completeTranscription = usedCloudProvider
      ? formatResult.text
      : normalizeTranscriptionBoundaries(
          formatResult.text,
          undefined,
          undefined,
        );

    const speechModelId = usedCloudProvider
      ? "amical-cloud"
      : selectedModelId || "whisper-local";
    const previousWordCount = countWords(
      record.text,
      record.detectedLanguage ?? record.language,
    );
    const nextWordCount = countWords(
      formatResult.textBeforeReplacements,
      detectedLanguage ?? language,
    );

    // Update the existing record in-place
    await updateTranscription(transcriptionId, {
      text: completeTranscription,
      detectedLanguage: this.sanitizeDetectedLanguage(detectedLanguage),
      speechModel: speechModelId,
      formattingModel: formatResult.formattingModel,
      meta: {
        ...(typeof record.meta === "object" && record.meta !== null
          ? record.meta
          : {}),
        retried: true,
        retriedAt: new Date().toISOString(),
      },
    });

    // Retries only upgrade a previously empty history row into its first
    // successful counted transcription. We intentionally do not rebalance
    // lifetime stats for already-counted rows when a retry changes the text.
    if (previousWordCount === 0 && nextWordCount > 0) {
      try {
        await incrementDailyStats(nextWordCount, new Date(), 0);
      } catch (error) {
        logger.transcription.error(
          "Failed to increment retry dictation stats",
          {
            transcriptionId,
            error,
          },
        );
      }
    }

    const processingDuration = performance.now() - retryStartedAt;
    const audioDurationSeconds = audioData.length / 16000;

    this.telemetryService.trackTranscriptionCompleted({
      session_id: retrySessionId,
      model_id: speechModelId,
      model_preloaded: this.modelWasPreloaded,
      total_duration_ms: processingDuration,
      processing_duration_ms: processingDuration,
      audio_duration_seconds: audioDurationSeconds,
      realtime_factor:
        audioDurationSeconds && processingDuration
          ? audioDurationSeconds / (processingDuration / 1000)
          : undefined,
      text_length: completeTranscription.length,
      word_count: nextWordCount,
      formatting_enabled: formatResult.formattingUsed,
      formatting_model: formatResult.formattingModel,
      formatting_duration_ms: formatResult.formattingDuration,
      vad_enabled: !!this.vadService,
      is_retry: true,
      languages: languages ?? [],
      vocabulary_size: vocabulary.length,
    });

    logger.transcription.info("Transcription retry completed", {
      transcriptionId,
      sessionId: retrySessionId,
      textLength: completeTranscription.length,
      formattingUsed: formatResult.formattingUsed,
    });

    return completeTranscription;
  }

  /**
   * Accumulate a transcription result into the results array.
   * Cloud provider returns cumulative text, so we replace; local provider appends.
   */
  private accumulateTranscriptionResult(
    results: string[],
    newText: string,
    isCloudProvider: boolean,
  ): void {
    if (!newText.trim()) return;
    if (isCloudProvider && results.length > 0) {
      results.length = 0;
    }
    results.push(newText);
  }

  private sanitizeDetectedLanguage(
    detectedLanguage?: string | null,
  ): string | undefined {
    const trimmed = detectedLanguage?.trim();
    return trimmed ? trimmed : undefined;
  }

  // The user can select several dictation languages with no ordering or
  // "primary". A single requested language only exists when exactly one is
  // selected; multi-select and auto-detect both mean "no single language" →
  // "auto". Used for the single-language sinks (transcription record column,
  // word-count segmentation, telemetry).
  private singleRequestedLanguage(languages: string[] | undefined): string {
    return languages?.length === 1 ? languages[0] : "auto";
  }

  private mergeDetectedLanguage(
    currentLanguage?: string,
    nextLanguage?: string,
  ): string | undefined {
    return (
      this.sanitizeDetectedLanguage(nextLanguage) ??
      this.sanitizeDetectedLanguage(currentLanguage)
    );
  }

  /**
   * Reset VAD state behind vadMutex so it cannot interleave with retry VAD computation.
   */
  async resetVadForNewSession(): Promise<void> {
    await this.vadMutex.runExclusive(() => {
      this.vadService?.reset();
    });
  }

  /**
   * Cleanup method
   */
  async dispose(): Promise<void> {
    await this.whisperProvider.dispose();
    await this.cloudProvider.dispose();
    // VAD service is managed by ServiceManager
    logger.transcription.info("Transcription service disposed");
  }
}
