import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { AuthService } from "../../../services/auth-service";
import { getUserAgent } from "../../../utils/http-client";
import { detectApplicationType } from "../formatting/formatter-prompt";
import type { GetAccessibilityContextResult } from "@amical/types";
import {
  AppError,
  ErrorCodes,
  type ErrorCode,
  type CloudErrorResponse,
} from "../../../types/error";

// Type guard to validate error codes from server
const isValidErrorCode = (code: string | undefined): code is ErrorCode =>
  code !== undefined && Object.values(ErrorCodes).includes(code as ErrorCode);

// Success response from cloud API (HTTP 200)
interface CloudTranscriptionSuccess {
  success: true;
  transcription: string;
  originalTranscription?: string;
  language?: string;
  duration?: number;
}

// Error response from cloud API (HTTP 4xx/5xx)
interface CloudTranscriptionError {
  error: CloudErrorResponse;
}

type CloudTranscriptionResponse =
  | CloudTranscriptionSuccess
  | CloudTranscriptionError;

export class AmicalCloudProvider implements TranscriptionProvider {
  readonly name = "amical-cloud";

  private authService: AuthService;
  private apiEndpoint: string;

  // Frame aggregation state (similar to WhisperProvider)
  private frameBuffer: Float32Array[] = [];
  private frameBufferSpeechProbabilities: number[] = [];
  private currentSilenceFrameCount = 0;
  private lastSpeechTimestamp = 0;
  private currentLanguage: string | undefined;
  private currentAccessibilityContext: GetAccessibilityContextResult | null =
    null;
  private currentAggregatedTranscription: string | undefined;
  private currentVocabulary: string[] = [];
  private currentSessionId: string | undefined;

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_AUDIO_DURATION_MS = 500; // Minimum buffered audio duration before silence-based transcription
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;

  constructor() {
    this.authService = AuthService.getInstance();

    // Configure endpoint based on environment
    this.apiEndpoint = process.env.API_ENDPOINT || __BUNDLED_API_ENDPOINT;

    logger.transcription.info("AmicalCloudProvider initialized", {
      endpoint: this.apiEndpoint,
    });
  }

  /**
   * Process an audio chunk - buffers and conditionally transcribes
   */
  async transcribe(params: TranscribeParams): Promise<string> {
    try {
      const { audioData, speechProbability = 1, context } = params;

      // Store context for API call
      this.currentLanguage = context.language;
      this.currentAccessibilityContext = context?.accessibilityContext ?? null;
      this.currentAggregatedTranscription = context?.aggregatedTranscription;
      this.currentVocabulary = context?.vocabulary ?? [];
      this.currentSessionId = context?.sessionId;

      // Check authentication
      if (!(await this.authService.isAuthenticated())) {
        throw new AppError(
          "Authentication required for cloud transcription",
          ErrorCodes.AUTH_REQUIRED,
        );
      }

      // Add frame to buffer with speech probability
      this.frameBuffer.push(audioData);
      this.frameBufferSpeechProbabilities.push(speechProbability);

      // Consider it speech if probability is above threshold
      const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;

      // Track speech and silence
      const now = Date.now();
      if (isSpeech) {
        this.currentSilenceFrameCount = 0;
        this.lastSpeechTimestamp = now;
      } else {
        this.currentSilenceFrameCount++;
      }

      // Only transcribe if speech/silence patterns indicate we should
      if (!this.shouldTranscribe()) {
        return "";
      }

      return this.doTranscription(false);
    } catch (error) {
      logger.transcription.error("Cloud transcription error:", error);
      throw error;
    }
  }

  /**
   * Flush any buffered audio and return transcription with formatting
   * Called at the end of a recording session
   */
  async flush(context: TranscribeContext): Promise<string> {
    try {
      // Store context for API call
      this.currentLanguage = context.language;
      this.currentAccessibilityContext = context?.accessibilityContext ?? null;
      this.currentAggregatedTranscription = context?.aggregatedTranscription;
      this.currentVocabulary = context?.vocabulary ?? [];
      this.currentSessionId = context?.sessionId;

      // Check authentication
      if (!(await this.authService.isAuthenticated())) {
        throw new AppError(
          "Authentication required for cloud transcription",
          ErrorCodes.AUTH_REQUIRED,
        );
      }

      const enableFormatting = context.formattingEnabled ?? false;
      // flush() is called at session end, so this is the final call
      return this.doTranscription(enableFormatting, true);
    } catch (error) {
      logger.transcription.error("Cloud transcription error:", error);
      throw error;
    }
  }

  /**
   * Shared transcription logic - aggregates buffer, calls cloud API, clears state
   * @param enableFormatting - Whether to enable formatting
   * @param isFinal - Whether this is the final call for the session (default: false)
   */
  private async doTranscription(
    enableFormatting: boolean,
    isFinal = false,
  ): Promise<string> {
    // Combine all frames into a single Float32Array
    const totalLength = this.frameBuffer.reduce(
      (acc, frame) => acc + frame.length,
      0,
    );
    const combinedAudio = new Float32Array(totalLength);
    let offset = 0;
    for (const frame of this.frameBuffer) {
      combinedAudio.set(frame, offset);
      offset += frame.length;
    }

    // Save VAD probabilities before clearing
    const vadProbs = [...this.frameBufferSpeechProbabilities];

    // Clear frame buffers only (context values needed for API call below)
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;

    // Make the API request
    return this.makeTranscriptionRequest(
      combinedAudio,
      vadProbs,
      false,
      enableFormatting,
      isFinal,
    );
  }

  /**
   * Clear internal buffers without transcribing
   * Called when cancelling a session to prevent audio bleed
   */
  reset(): void {
    this.frameBuffer = [];
    this.frameBufferSpeechProbabilities = [];
    this.currentSilenceFrameCount = 0;
    this.currentLanguage = undefined;
    this.currentAccessibilityContext = null;
    this.currentAggregatedTranscription = undefined;
    this.currentSessionId = undefined;
  }

  private shouldTranscribe(): boolean {
    const silenceDuration =
      ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
      1000;
    const audioDuration =
      ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;

    return (
      audioDuration >= this.MIN_AUDIO_DURATION_MS &&
      silenceDuration >= this.MAX_SILENCE_DURATION_MS
    );
  }

  private async makeTranscriptionRequest(
    audioData: Float32Array,
    vadProbs: number[],
    isRetry = false,
    enableFormatting = false,
    isFinal = false,
  ): Promise<string> {
    // Skip API call if there's nothing to process
    if (audioData.length === 0) {
      const hasTextToFormat =
        enableFormatting && this.currentAggregatedTranscription?.trim();
      if (!hasTextToFormat) {
        return "";
      }
    }

    // Get auth token
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new AppError(
        "No authentication token available",
        ErrorCodes.AUTH_REQUIRED,
      );
    }

    // Calculate duration in seconds
    const duration = audioData.length / this.SAMPLE_RATE;

    logger.transcription.info("Sending audio to cloud API", {
      audioLength: audioData.length,
      sampleRate: this.SAMPLE_RATE,
      duration,
      isRetry,
      formatting: enableFormatting,
      sessionId: this.currentSessionId,
      isFinal,
    });

    // Wrap fetch in try-catch to handle network errors
    let response: Response;
    try {
      response = await fetch(`${this.apiEndpoint}/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
          "User-Agent": getUserAgent(),
        },
        body: JSON.stringify({
          sessionId: this.currentSessionId,
          isFinal,
          audioData: Buffer.from(
            audioData.buffer,
            audioData.byteOffset,
            audioData.byteLength,
          ).toString("base64"),
          vadProbs,
          language: this.currentLanguage,
          vocabulary: this.currentVocabulary,
          previousTranscription: this.currentAggregatedTranscription,
          formatting: {
            enabled: enableFormatting,
          },
          sharedContext: this.currentAccessibilityContext
            ? (() => {
                const appType = detectApplicationType(
                  this.currentAccessibilityContext,
                );
                // Terminal apps expose noisy accessibility context (command
                // output, ANSI escapes, prompt strings) that degrades cloud
                // transcription quality.  Strip text fields and send appType
                // as "default" since the server does not yet know "terminal".
                const isTerminal = appType === "terminal";
                return {
                  selectedText: isTerminal
                    ? undefined
                    : this.currentAccessibilityContext!.context?.textSelection
                        ?.selectedText,
                  beforeText: isTerminal
                    ? undefined
                    : this.currentAccessibilityContext!.context?.textSelection
                        ?.preSelectionText,
                  afterText: isTerminal
                    ? undefined
                    : this.currentAccessibilityContext!.context?.textSelection
                        ?.postSelectionText,
                  appType: isTerminal ? "default" : appType,
                  appBundleId:
                    this.currentAccessibilityContext!.context?.application
                      ?.bundleIdentifier,
                  appName:
                    this.currentAccessibilityContext!.context?.application?.name,
                  appUrl:
                    this.currentAccessibilityContext!.context?.windowInfo?.url,
                  surroundingContext: "",
                };
              })()
            : undefined,
        }),
      });
    } catch (fetchError) {
      // Network error (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, etc.)
      throw new AppError(
        fetchError instanceof Error ? fetchError.message : "Network error",
        ErrorCodes.NETWORK_ERROR,
      );
    }

    // Handle 401 with token refresh and retry
    if (response.status === 401) {
      if (isRetry) {
        // Already retried once, give up
        let errorData: CloudErrorResponse | undefined;
        try {
          const result: CloudTranscriptionResponse = await response.json();
          if ("error" in result) {
            errorData = result.error;
          }
        } catch {
          // Response body wasn't valid JSON
        }
        throw new AppError(
          "Cloud auth failed after retry",
          ErrorCodes.AUTH_REQUIRED,
          401,
          errorData?.ui?.title,
          errorData?.message,
          errorData?.id,
        );
      }

      logger.transcription.warn(
        "Got 401 response, attempting token refresh and retry",
      );

      try {
        // Force token refresh
        await this.authService.refreshTokenIfNeeded();

        // Retry the request once (preserve formatting and isFinal flags)
        return await this.makeTranscriptionRequest(
          audioData,
          vadProbs,
          true,
          enableFormatting,
          isFinal,
        );
      } catch (refreshError) {
        logger.transcription.error("Token refresh failed:", refreshError);
        throw new AppError(
          "Authentication failed - please log in again",
          ErrorCodes.AUTH_REQUIRED,
          401,
        );
      }
    }

    // Handle all non-ok responses
    if (!response.ok) {
      let errorData: CloudErrorResponse | undefined;
      try {
        const result: CloudTranscriptionResponse = await response.json();
        if ("error" in result) {
          errorData = result.error;
        }
      } catch {
        // Response body wasn't valid JSON
      }

      logger.transcription.error("Cloud API error:", {
        status: response.status,
        statusText: response.statusText,
        errorCode: errorData?.code,
        errorTitle: errorData?.ui?.title,
        errorMessage: errorData?.message,
        traceId: errorData?.id,
      });

      // Use server error code if valid, otherwise fallback based on HTTP status
      let errorCode: ErrorCode;
      if (isValidErrorCode(errorData?.code)) {
        errorCode = errorData.code;
      } else if (response.status === 403) {
        errorCode = ErrorCodes.AUTH_REQUIRED;
      } else if (response.status === 429) {
        errorCode = ErrorCodes.RATE_LIMIT_EXCEEDED;
      } else if (response.status >= 500) {
        errorCode = ErrorCodes.INTERNAL_SERVER_ERROR;
      } else {
        errorCode = ErrorCodes.UNKNOWN;
      }

      throw new AppError(
        `Cloud API error: ${response.status} ${response.statusText}`,
        errorCode,
        response.status,
        errorData?.ui?.title,
        errorData?.message,
        errorData?.id,
      );
    }

    const result: CloudTranscriptionSuccess = await response.json();

    logger.transcription.info("Cloud transcription successful", {
      textLength: result.transcription.length,
      language: result.language,
      duration: result.duration,
      transcription: result.transcription,
    });

    return result.transcription;
  }
}
