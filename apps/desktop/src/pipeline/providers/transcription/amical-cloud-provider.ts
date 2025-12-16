import {
  TranscriptionProvider,
  TranscribeParams,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { AuthService } from "../../../services/auth-service";
import { getUserAgent } from "../../../utils/http-client";
import { detectApplicationType } from "../formatting/formatter-prompt";
import type { GetAccessibilityContextResult } from "@amical/types";

interface CloudTranscriptionResponse {
  success: boolean;
  transcription?: string;
  originalTranscription?: string;
  language?: string;
  duration?: number;
  error?: string;
}

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

  // Configuration
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_SPEECH_DURATION_MS = 500; // Minimum speech duration to transcribe
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

  async transcribe(params: TranscribeParams): Promise<string> {
    try {
      const {
        audioData,
        speechProbability = 1,
        flush = false,
        context,
      } = params;

      // Store language for use in API call (undefined = auto-detect)
      this.currentLanguage = context.language;

      // Store accessibility context for the API request
      this.currentAccessibilityContext = context?.accessibilityContext ?? null;

      this.currentAggregatedTranscription = context?.aggregatedTranscription;

      // Check authentication
      if (!(await this.authService.isAuthenticated())) {
        throw new Error("Authentication required for cloud transcription");
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

      // Calculate durations
      const silenceDuration =
        ((this.currentSilenceFrameCount * this.FRAME_SIZE) / this.SAMPLE_RATE) *
        1000;
      const speechDuration =
        ((this.frameBuffer.length * this.FRAME_SIZE) / this.SAMPLE_RATE) * 1000;

      // Determine if we should process
      const shouldProcess =
        flush ||
        (speechDuration >= this.MIN_SPEECH_DURATION_MS &&
          silenceDuration >= this.MAX_SILENCE_DURATION_MS);

      if (!shouldProcess) {
        return "";
      }

      // Process accumulated audio (pass flush flag for formatting decision)
      const result = await this.processAudio(flush);

      // Clear buffer after processing
      this.frameBuffer = [];
      this.frameBufferSpeechProbabilities = [];
      this.currentSilenceFrameCount = 0;

      return result;
    } catch (error) {
      logger.transcription.error("Cloud transcription error:", error);
      throw error;
    }
  }

  private async processAudio(isFinal: boolean = false): Promise<string> {
    // Combine all frames into a single Float32Array (may be empty)
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

    // Try transcription with automatic retry on 401
    // Enable formatting only on final chunk
    return this.makeTranscriptionRequest(combinedAudio, false, isFinal);
  }

  private async makeTranscriptionRequest(
    audioData: Float32Array,
    isRetry = false,
    enableFormatting = false,
  ): Promise<string> {
    // Skip API call if no audio and formatting not requested
    if (audioData.length === 0 && !enableFormatting) {
      return "";
    }

    // Get auth token
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error("No authentication token available");
    }

    // Calculate duration in seconds
    const duration = audioData.length / this.SAMPLE_RATE;

    logger.transcription.info("Sending audio to cloud API", {
      audioLength: audioData.length,
      sampleRate: this.SAMPLE_RATE,
      duration,
      isRetry,
      formatting: enableFormatting,
    });

    try {
      const response = await fetch(`${this.apiEndpoint}/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
          "User-Agent": getUserAgent(),
        },
        body: JSON.stringify({
          audioData: Array.from(audioData),
          language: this.currentLanguage,
          previousTranscription: this.currentAggregatedTranscription,
          formatting: {
            enabled: enableFormatting,
          },
          sharedContext: this.currentAccessibilityContext
            ? {
                selectedText:
                  this.currentAccessibilityContext.context?.textSelection
                    ?.selectedText,
                beforeText:
                  this.currentAccessibilityContext.context?.textSelection
                    ?.preSelectionText,
                afterText:
                  this.currentAccessibilityContext.context?.textSelection
                    ?.postSelectionText,
                appType: detectApplicationType(
                  this.currentAccessibilityContext,
                ),
                appBundleId:
                  this.currentAccessibilityContext.context?.application
                    ?.bundleIdentifier,
                appName:
                  this.currentAccessibilityContext.context?.application?.name,
                appUrl:
                  this.currentAccessibilityContext.context?.windowInfo?.url,
                surroundingContext: "", // Empty for now, future enhancement
              }
            : undefined,
        }),
      });

      // Handle 401 with token refresh and retry
      if (response.status === 401) {
        if (isRetry) {
          // Already retried once, give up
          throw new Error("Authentication failed - please log in again");
        }

        logger.transcription.warn(
          "Got 401 response, attempting token refresh and retry",
        );

        try {
          // Force token refresh
          await this.authService.refreshTokenIfNeeded();

          // Retry the request once (preserve formatting flag)
          return await this.makeTranscriptionRequest(
            audioData,
            true,
            enableFormatting,
          );
        } catch (refreshError) {
          logger.transcription.error("Token refresh failed:", refreshError);
          throw new Error("Authentication failed - please log in again");
        }
      }

      if (response.status === 403) {
        throw new Error("Subscription required for cloud transcription");
      }

      if (response.status === 429) {
        const errorData = await response.json();
        throw new Error(
          `Word limit exceeded: ${errorData.currentWords}/${errorData.limit}`,
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.transcription.error("Cloud API error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Cloud API error: ${response.statusText}`);
      }

      const result: CloudTranscriptionResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Cloud transcription failed");
      }

      logger.transcription.info("Cloud transcription successful", {
        textLength: result.transcription?.length || 0,
        language: result.language,
        duration: result.duration,
      });

      return result.transcription || "";
    } catch (error) {
      logger.transcription.error("Cloud transcription request failed:", error);
      throw error;
    }
  }
}
