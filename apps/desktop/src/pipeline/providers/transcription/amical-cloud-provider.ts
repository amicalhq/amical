import {
  TranscriptionProvider,
  TranscribeParams,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { AuthService } from "../../../services/auth-service";
import { getUserAgent } from "../../../utils/http-client";

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

      // Process accumulated audio
      const result = await this.processAudio();

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

  private async processAudio(): Promise<string> {
    if (this.frameBuffer.length === 0) {
      return "";
    }

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

    // Try transcription with automatic retry on 401
    return this.makeTranscriptionRequest(combinedAudio);
  }

  private async makeTranscriptionRequest(
    audioData: Float32Array,
    isRetry = false,
  ): Promise<string> {
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

          // Retry the request once
          return await this.makeTranscriptionRequest(audioData, true);
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
