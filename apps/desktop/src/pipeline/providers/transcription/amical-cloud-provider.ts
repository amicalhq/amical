import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionOutput,
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
import {
  CloudDictationGrpcStream,
  GrpcDictationError,
  GRPC_STATUS_PERMISSION_DENIED,
  GRPC_STATUS_RESOURCE_EXHAUSTED,
  GRPC_STATUS_UNAUTHENTICATED,
  type GrpcStreamContext,
  float32ToPcmS16lePacket,
} from "./grpc-dictation-client";

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
  private grpcEndpoint: string;
  private transport: "grpc" | "http";

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

  // gRPC stream state. Audio is packetized as fixed 32ms PCM_S16LE frames
  // because the Axis streaming API validates every packet size.
  private grpcStream: CloudDictationGrpcStream | null = null;
  private grpcPendingFrames: Float32Array[] = [];
  private grpcPendingSampleCount = 0;
  private grpcNextSeq = 1n;

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
    this.grpcEndpoint = this.apiEndpoint;
    // Runtime-only escape hatch; the bundled default is intentionally gRPC.
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const configuredTransport = process.env.CLOUD_DICTATION_TRANSPORT || "";
    this.transport =
      configuredTransport.trim().toLowerCase() === "http" ? "http" : "grpc";

    logger.transcription.info("AmicalCloudProvider initialized", {
      endpoint: this.apiEndpoint,
      grpcEndpoint: this.grpcEndpoint,
      transport: this.transport,
    });
  }

  /**
   * Process an audio chunk - buffers and conditionally transcribes
   */
  async transcribe(params: TranscribeParams): Promise<TranscriptionOutput> {
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

      if (this.transport === "grpc") {
        return await this.transcribeGrpc(audioData, context);
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
        return { text: "" };
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
  async flush(context: TranscribeContext): Promise<TranscriptionOutput> {
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
      if (this.transport === "grpc") {
        return await this.flushGrpc(enableFormatting);
      }

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
  ): Promise<TranscriptionOutput> {
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
    this.currentVocabulary = [];
    this.resetGrpcStream();
  }

  private async transcribeGrpc(
    audioData: Float32Array,
    context: TranscribeContext,
  ): Promise<TranscriptionOutput> {
    if (audioData.length === 0) {
      return { text: "" };
    }

    try {
      this.enqueueGrpcAudio(audioData);
      await this.ensureGrpcStream(context.formattingEnabled ?? false);
      await this.sendReadyGrpcPackets(false);
      return { text: "" };
    } catch (error) {
      this.resetGrpcStream();
      throw this.toAppError(error);
    }
  }

  private async flushGrpc(
    enableFormatting: boolean,
  ): Promise<TranscriptionOutput> {
    if (!this.grpcStream && this.grpcPendingSampleCount === 0) {
      return { text: "" };
    }

    try {
      const result = await this.finalizeGrpcStream(enableFormatting);
      return {
        text: result.formattedTranscript || result.rawTranscript,
      };
    } catch (error) {
      throw this.toAppError(error);
    } finally {
      this.clearGrpcAudioState();
    }
  }

  private async finalizeGrpcStream(enableFormatting: boolean) {
    const stream = await this.ensureGrpcStream(enableFormatting);
    await this.sendReadyGrpcPackets(true);

    return await stream.finalize();
  }

  private async ensureGrpcStream(
    enableFormatting: boolean,
  ): Promise<CloudDictationGrpcStream> {
    if (this.grpcStream) {
      return this.grpcStream;
    }

    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new AppError(
        "No authentication token available",
        ErrorCodes.AUTH_REQUIRED,
      );
    }

    const sessionId =
      this.currentSessionId || `cloud-${Date.now().toString(36)}`;
    const openOptions = {
      endpoint: this.grpcEndpoint,
      token: idToken,
      userAgent: getUserAgent(),
      sessionId,
      language: this.currentLanguage,
      vocabulary: this.currentVocabulary,
      formatting: enableFormatting,
      context: this.buildGrpcStreamContext(),
    };

    this.grpcStream = new CloudDictationGrpcStream(openOptions);

    logger.transcription.info("Cloud gRPC stream opened", {
      endpoint: this.grpcEndpoint,
      sessionId,
      language: this.currentLanguage,
      vocabularySize: this.currentVocabulary.length,
      formatting: enableFormatting,
    });

    return this.grpcStream;
  }

  private enqueueGrpcAudio(audioData: Float32Array): void {
    if (audioData.length === 0) {
      return;
    }

    this.grpcPendingFrames.push(audioData);
    this.grpcPendingSampleCount += audioData.length;
  }

  private takeGrpcPacket(padFinalPacket: boolean): Float32Array | null {
    const packetSamples = CloudDictationGrpcStream.PACKET_SAMPLES;
    if (
      this.grpcPendingSampleCount < packetSamples &&
      !(padFinalPacket && this.grpcPendingSampleCount > 0)
    ) {
      return null;
    }

    const packet = new Float32Array(packetSamples);
    let written = 0;

    while (written < packetSamples && this.grpcPendingFrames.length > 0) {
      const frame = this.grpcPendingFrames[0];
      const samplesNeeded = packetSamples - written;
      const samplesToCopy = Math.min(frame.length, samplesNeeded);

      packet.set(frame.subarray(0, samplesToCopy), written);
      written += samplesToCopy;

      if (samplesToCopy === frame.length) {
        this.grpcPendingFrames.shift();
      } else {
        this.grpcPendingFrames[0] = frame.subarray(samplesToCopy);
      }

      this.grpcPendingSampleCount -= samplesToCopy;
    }

    return packet;
  }

  private async sendReadyGrpcPackets(padFinalPacket: boolean): Promise<void> {
    while (true) {
      const packet = this.takeGrpcPacket(padFinalPacket);
      if (!packet) {
        return;
      }

      await this.sendGrpcPacket(float32ToPcmS16lePacket(packet));
    }
  }

  private async sendGrpcPacket(packet: Uint8Array): Promise<void> {
    const stream = await this.ensureGrpcStream(false);
    const seq = this.grpcNextSeq;
    await stream.sendAudioBatch(seq, [packet]);
    this.grpcNextSeq += 1n;
  }

  private buildGrpcStreamContext(): GrpcStreamContext | undefined {
    if (!this.currentAccessibilityContext) {
      return undefined;
    }

    return {
      selectedText:
        this.currentAccessibilityContext.context?.textSelection?.selectedText ??
        undefined,
      beforeText:
        this.currentAccessibilityContext.context?.textSelection
          ?.preSelectionText ?? undefined,
      afterText:
        this.currentAccessibilityContext.context?.textSelection
          ?.postSelectionText ?? undefined,
      appType: detectApplicationType(this.currentAccessibilityContext),
      appBundleId:
        this.currentAccessibilityContext.context?.application
          ?.bundleIdentifier ?? undefined,
      appName:
        this.currentAccessibilityContext.context?.application?.name ??
        undefined,
      appUrl:
        this.currentAccessibilityContext.context?.windowInfo?.url ?? undefined,
    };
  }

  private resetGrpcStream(): void {
    this.grpcStream?.cancel();
    this.clearGrpcAudioState();
  }

  private clearGrpcAudioState(): void {
    this.grpcStream = null;
    this.grpcPendingFrames = [];
    this.grpcPendingSampleCount = 0;
    this.grpcNextSeq = 1n;
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof GrpcDictationError) {
      const build = (code: ErrorCode, status: number | undefined) =>
        new AppError(error.message, code, {
          statusCode: status,
          traceId: error.traceId,
        });

      switch (error.grpcStatus) {
        case GRPC_STATUS_UNAUTHENTICATED:
          return build(ErrorCodes.AUTH_REQUIRED, 401);
        case GRPC_STATUS_RESOURCE_EXHAUSTED:
          return build(ErrorCodes.RATE_LIMIT_EXCEEDED, 429);
        case GRPC_STATUS_PERMISSION_DENIED:
          return build(ErrorCodes.AUTH_REQUIRED, 403);
      }

      switch (error.httpStatus) {
        case 401:
          return build(ErrorCodes.AUTH_REQUIRED, 401);
        case 403:
          return build(ErrorCodes.AUTH_REQUIRED, 403);
        case 429:
          return build(ErrorCodes.RATE_LIMIT_EXCEEDED, 429);
      }

      if (error.httpStatus && error.httpStatus >= 500) {
        return build(ErrorCodes.INTERNAL_SERVER_ERROR, error.httpStatus);
      }

      return build(ErrorCodes.UNKNOWN, error.httpStatus);
    }

    return new AppError(
      error instanceof Error ? error.message : "Network error",
      ErrorCodes.NETWORK_ERROR,
    );
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
  ): Promise<TranscriptionOutput> {
    // Skip API call if there's nothing to process
    if (audioData.length === 0) {
      const hasTextToFormat =
        enableFormatting && this.currentAggregatedTranscription?.trim();
      if (!hasTextToFormat) {
        return { text: "" };
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
          {
            statusCode: 401,
            uiTitle: errorData?.ui?.title,
            uiMessage: errorData?.message,
            traceId: errorData?.id,
          },
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
          { statusCode: 401 },
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
        {
          statusCode: response.status,
          uiTitle: errorData?.ui?.title,
          uiMessage: errorData?.message,
          traceId: errorData?.id,
        },
      );
    }

    const result: CloudTranscriptionSuccess = await response.json();

    logger.transcription.info("Cloud transcription successful", {
      textLength: result.transcription.length,
      language: result.language,
      duration: result.duration,
      transcription: result.transcription,
    });

    return {
      text: result.transcription,
      detectedLanguage: result.language,
    };
  }
}
