import { Effect, Ref } from "effect";
import type { TranscriptionOutput } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import {
  AppError,
  ErrorCodes,
  isDictationErrorCode,
  mapDictationErrorCodeToErrorCode,
  type CloudErrorResponse,
  type DictationErrorCode,
  type ErrorCode,
} from "../../../types/error";
import {
  AMICAL_LABS_HEADER,
  buildAmicalLabsHeader,
  getAmicalClientHeaders,
  getUserAgent,
} from "../../../utils/http-client";
import {
  CloudAuth,
  CloudConfig,
  getIdTokenEffect,
  projectAccessibilityContext,
  requestSnapshotEffect,
  toNetworkAppError,
  type CloudProviderEffect,
  type ProviderRequestSnapshot,
  type ProviderState,
} from "./amical-cloud-provider-state";
import type { DictationSkill } from "./dictation-skill";
import { float32ToPcmS16le } from "./grpc-dictation-client";
import { resolveSessionSkills } from "./skill-resolution";

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

interface ClassifiedHttpError {
  errorCode: ErrorCode;
  applicationCode?: DictationErrorCode;
}

type CloudTranscriptionResponse =
  | CloudTranscriptionSuccess
  | CloudTranscriptionError;

interface TranscriptionRequest {
  audioData: Float32Array;
  vadProbs: number[];
  isRetry?: boolean;
  enableFormatting?: boolean;
  isFinal?: boolean;
  snapshot?: ProviderRequestSnapshot;
  skills?: DictationSkill[];
}

/** Owns the mechanics of the cloud HTTP route for one provider session. */
export class AmicalCloudHttpTransport {
  private readonly FRAME_SIZE = 512; // 32ms at 16kHz
  private readonly MIN_AUDIO_DURATION_MS = 500; // Minimum buffered audio duration before silence-based transcription
  private readonly MAX_SILENCE_DURATION_MS = 3000; // Max silence before cutting
  private readonly SAMPLE_RATE = 16000;
  private readonly HTTP_AUTO_FLUSH_SAMPLE_COUNT = 28 * this.SAMPLE_RATE;
  private readonly SPEECH_PROBABILITY_THRESHOLD = 0.2;
  // Axis computes VAD server-side. Keep the client path available for a
  // controlled re-enable without sending client probabilities by default.
  private readonly CLOUD_CLIENT_VAD_ENABLED = false;

  constructor(
    private readonly state: Ref.Ref<ProviderState>,
    private readonly failIfClosedEffect: () => Effect.Effect<void, AppError>,
  ) {}

  transcribeViaHttpEffect(
    audioData: Float32Array,
    speechProbability: number,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      yield* this.bufferHttpFrameEffect(audioData, speechProbability);
      return yield* this.transcribeFromBufferEffect();
    });
  }

  /**
   * Transcribe whatever is already in frameBuffer, without buffering a new
   * chunk. Used as the transcribe-stage HTTP fallback route: the current chunk
   * was already captured by the session mirror and seeded into frameBuffer by
   * the provider, so re-buffering it here would duplicate audio.
   */
  transcribeFromBufferEffect(): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const shouldTranscribe = yield* this.shouldTranscribeEffect();
      if (!shouldTranscribe) {
        return { text: "" };
      }
      return yield* this.doTranscriptionEffect(false);
    });
  }

  flushEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<TranscriptionOutput> {
    return this.doTranscriptionEffect(enableFormatting, true);
  }

  /**
   * Shared transcription logic - aggregates buffer, calls cloud API, clears state
   * @param enableFormatting - Whether to enable formatting
   * @param isFinal - Whether this is the final call for the session (default: false)
   */
  private doTranscriptionEffect(
    enableFormatting: boolean,
    isFinal = false,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      const { combinedAudio, vadProbs } = yield* Ref.modify(
        this.state,
        (
          state,
        ): readonly [
          { combinedAudio: Float32Array; vadProbs: number[] },
          ProviderState,
        ] => {
          const totalLength = state.frameBuffer.reduce(
            (acc, frame) => acc + frame.length,
            0,
          );
          const combinedAudio = new Float32Array(totalLength);
          let offset = 0;
          for (const frame of state.frameBuffer) {
            combinedAudio.set(frame, offset);
            offset += frame.length;
          }

          const vadProbs = [...state.frameBufferSpeechProbabilities];

          const nextState: ProviderState = {
            ...state,
            frameBuffer: [],
            frameBufferSpeechProbabilities: [],
            currentSilenceFrameCount: 0,
          };

          return [{ combinedAudio, vadProbs }, nextState] as const;
        },
      );

      return yield* this.makeTranscriptionRequestEffect({
        audioData: combinedAudio,
        vadProbs,
        enableFormatting,
        isFinal,
      });
    });
  }

  private bufferHttpFrameEffect(
    audioData: Float32Array,
    speechProbability: number,
  ): CloudProviderEffect<void> {
    return Ref.update(this.state, (state) => {
      const isSpeech = speechProbability > this.SPEECH_PROBABILITY_THRESHOLD;
      const now = Date.now();

      return {
        ...state,
        frameBuffer: [...state.frameBuffer, audioData],
        frameBufferSpeechProbabilities: [
          ...state.frameBufferSpeechProbabilities,
          speechProbability,
        ],
        currentSilenceFrameCount: isSpeech
          ? 0
          : state.currentSilenceFrameCount + 1,
        lastSpeechTimestamp: isSpeech ? now : state.lastSpeechTimestamp,
      };
    });
  }

  private shouldTranscribeEffect(): CloudProviderEffect<boolean> {
    return Ref.get(this.state).pipe(
      Effect.map((state) => {
        const bufferedSampleCount = state.frameBuffer.reduce(
          (sampleCount, frame) => sampleCount + frame.length,
          0,
        );
        const silenceDuration =
          ((state.currentSilenceFrameCount * this.FRAME_SIZE) /
            this.SAMPLE_RATE) *
          1000;
        const audioDuration = (bufferedSampleCount / this.SAMPLE_RATE) * 1000;

        return (
          bufferedSampleCount >= this.HTTP_AUTO_FLUSH_SAMPLE_COUNT ||
          (this.CLOUD_CLIENT_VAD_ENABLED &&
            audioDuration >= this.MIN_AUDIO_DURATION_MS &&
            silenceDuration >= this.MAX_SILENCE_DURATION_MS)
        );
      }),
    );
  }

  private refreshTokenEffect(force = false): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const auth = yield* CloudAuth;
      yield* auth.refreshTokenIfNeeded(force);
    });
  }

  private fetchTranscriptionEffect(
    snapshot: ProviderRequestSnapshot,
    idToken: string,
    audioData: Float32Array,
    vadProbs: number[],
    enableFormatting: boolean,
    isFinal: boolean,
    skills: DictationSkill[] | undefined,
    signal: AbortSignal,
  ): CloudProviderEffect<Response> {
    // Empty audio is the text-only finalize path; preserve the
    // original "" wire shape so the server's default float32 path keeps working.
    const hasAudio = audioData.length > 0;
    return Effect.gen(this, function* () {
      const config = yield* CloudConfig;
      const audioPayload = hasAudio
        ? Buffer.from(float32ToPcmS16le(audioData)).toString("base64")
        : "";
      const labsHeader = buildAmicalLabsHeader(snapshot.enabledLabs);
      return yield* Effect.tryPromise({
        try: () =>
          fetch(`${config.apiEndpoint}/transcribe`, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
              "User-Agent": getUserAgent(),
              ...getAmicalClientHeaders(),
              ...(labsHeader ? { [AMICAL_LABS_HEADER]: labsHeader } : {}),
            },
            body: JSON.stringify({
              sessionId: snapshot.currentSessionId,
              isFinal,
              audioData: audioPayload,
              audioFormat: hasAudio ? "pcm_s16le" : undefined,
              vadProbs: this.CLOUD_CLIENT_VAD_ENABLED ? vadProbs : undefined,
              languages: snapshot.currentLanguages,
              vocabulary: snapshot.currentVocabulary,
              previousTranscription: snapshot.currentAggregatedTranscription,
              formatting: {
                enabled: enableFormatting,
              },
              skills,
              sharedContext: snapshot.currentAccessibilityContext
                ? {
                    ...projectAccessibilityContext(
                      snapshot.currentAccessibilityContext,
                    ),
                    surroundingContext: "",
                  }
                : undefined,
            }),
          }),
        // A dismiss-triggered abort surfaces here as a rejected fetch; map it
        // like any network failure. (No special CANCELLED/499 code is needed —
        // shouldFallbackToHttp only inspects the gRPC attempt, never this HTTP
        // route, so an aborted fetch can't spawn a phantom fallback.)
        catch: toNetworkAppError,
      });
    });
  }

  private readCloudErrorResponseEffect(
    response: Response,
  ): CloudProviderEffect<CloudErrorResponse | undefined> {
    return Effect.promise(async () => {
      try {
        const result = (await response.json()) as CloudTranscriptionResponse;
        if ("error" in result) {
          return result.error;
        }
      } catch {
        // Response body wasn't valid JSON
      }

      return undefined;
    });
  }

  private readCloudSuccessResponseEffect(
    response: Response,
  ): CloudProviderEffect<CloudTranscriptionSuccess> {
    return Effect.tryPromise({
      try: async () => (await response.json()) as CloudTranscriptionSuccess,
      catch: () =>
        new AppError(
          "Invalid cloud API response",
          ErrorCodes.INTERNAL_SERVER_ERROR,
          {
            httpStatus: response.status,
          },
        ),
    });
  }

  private classifyHttpError(
    response: Response,
    errorData: CloudErrorResponse | undefined,
  ): ClassifiedHttpError {
    if (isDictationErrorCode(errorData?.code)) {
      return {
        errorCode: mapDictationErrorCodeToErrorCode(errorData.code),
        applicationCode: errorData.code,
      };
    }
    if (response.status === 401) {
      return { errorCode: ErrorCodes.AUTH_REQUIRED };
    }
    if (response.status === 402) {
      return { errorCode: ErrorCodes.QUOTA_EXCEEDED };
    }
    if (response.status === 403) {
      return { errorCode: ErrorCodes.AUTH_REQUIRED };
    }
    if (response.status === 429) {
      return { errorCode: ErrorCodes.RATE_LIMIT_EXCEEDED };
    }
    if (response.status >= 500) {
      return { errorCode: ErrorCodes.INTERNAL_SERVER_ERROR };
    }
    return { errorCode: ErrorCodes.UNKNOWN };
  }

  private makeTranscriptionRequestEffect(
    request: TranscriptionRequest,
  ): CloudProviderEffect<TranscriptionOutput> {
    const {
      audioData,
      vadProbs,
      isRetry = false,
      enableFormatting = false,
      isFinal = false,
      snapshot,
      skills: preResolvedSkills,
    } = request;
    const abortController = new AbortController();
    const releaseRequest = Ref.update(this.state, (state) =>
      state.httpAbortController === abortController
        ? { ...state, httpAbortController: null }
        : state,
    );

    return Effect.gen(this, function* () {
      yield* this.failIfClosedEffect();
      const requestSnapshot =
        snapshot ?? (yield* requestSnapshotEffect(this.state));
      const hasPriorText =
        !!requestSnapshot.currentAggregatedTranscription?.trim();
      if (audioData.length === 0 && (!isFinal || !hasPriorText)) {
        return { text: "" };
      }

      // Resolve skills for text-only finals too, so instruct matches the gRPC
      // final path even when formatting is toggled off.
      const skills =
        preResolvedSkills ??
        (isFinal
          ? yield* Effect.promise(() =>
              resolveSessionSkills({
                isInstruct: requestSnapshot.currentIsInstruct,
                enableFormatting,
                accessibilityContext:
                  requestSnapshot.currentAccessibilityContext,
              }),
            )
          : undefined);
      yield* this.failIfClosedEffect();

      // Register before token lookup. Auth remains non-interruptible, but a
      // cancelled session cannot install a fetch after that lookup completes.
      yield* Ref.update(this.state, (state) => ({
        ...state,
        httpAbortController: abortController,
      }));
      const idToken = yield* getIdTokenEffect();
      yield* this.failIfClosedEffect();
      const duration = audioData.length / this.SAMPLE_RATE;

      yield* Effect.sync(() => {
        logger.transcription.info("Sending audio to cloud API", {
          audioLength: audioData.length,
          sampleRate: this.SAMPLE_RATE,
          duration,
          isRetry,
          formatting: enableFormatting,
          sessionId: requestSnapshot.currentSessionId,
          isFinal,
        });
      });

      const response = yield* this.fetchTranscriptionEffect(
        requestSnapshot,
        idToken,
        audioData,
        vadProbs,
        enableFormatting,
        isFinal,
        skills,
        abortController.signal,
      );

      if (response.status === 401) {
        if (isRetry) {
          const errorData = yield* this.readCloudErrorResponseEffect(response);
          const classifiedError = this.classifyHttpError(response, errorData);
          return yield* Effect.fail(
            new AppError(
              errorData?.message ?? "Cloud auth failed after retry",
              classifiedError.errorCode,
              {
                applicationCode: classifiedError.applicationCode,
                httpStatus: response.status,
                uiTitle: errorData?.ui?.title,
                uiMessage: classifiedError.applicationCode
                  ? errorData?.localizedMessage?.message
                  : undefined,
                traceId: errorData?.traceId ?? errorData?.id,
              },
            ),
          );
        }

        yield* Effect.sync(() => {
          logger.transcription.warn(
            "Got 401 response, attempting token refresh and retry",
          );
        });

        // Force token refresh, then retry once. Retry failures should surface as
        // their own errors instead of being collapsed into auth failure.
        yield* this.refreshTokenEffect(true).pipe(
          Effect.catchAll((refreshError) =>
            Effect.gen(this, function* () {
              yield* Effect.sync(() => {
                logger.transcription.error(
                  "Token refresh failed:",
                  refreshError,
                );
              });
              return yield* Effect.fail(
                new AppError(
                  "Authentication failed - please log in again",
                  ErrorCodes.AUTH_REQUIRED,
                  { httpStatus: 401 },
                ),
              );
            }),
          ),
        );
        yield* this.failIfClosedEffect();

        return yield* this.makeTranscriptionRequestEffect({
          audioData,
          vadProbs,
          isRetry: true,
          enableFormatting,
          isFinal,
          skills,
          snapshot: requestSnapshot,
        });
      }

      if (!response.ok) {
        const errorData = yield* this.readCloudErrorResponseEffect(response);
        const classifiedError = this.classifyHttpError(response, errorData);

        yield* Effect.sync(() => {
          logger.transcription.error("Cloud API error:", {
            status: response.status,
            statusText: response.statusText,
            errorCode: errorData?.code,
            errorTitle: errorData?.ui?.title,
            errorMessage: errorData?.message,
            localizedErrorMessage: errorData?.localizedMessage?.message,
            traceId: errorData?.traceId ?? errorData?.id,
          });
        });

        return yield* Effect.fail(
          new AppError(
            errorData?.message ??
              `Cloud API error: ${response.status} ${response.statusText}`,
            classifiedError.errorCode,
            {
              applicationCode: classifiedError.applicationCode,
              httpStatus: response.status,
              uiTitle: errorData?.ui?.title,
              uiMessage: classifiedError.applicationCode
                ? errorData?.localizedMessage?.message
                : undefined,
              traceId: errorData?.traceId ?? errorData?.id,
            },
          ),
        );
      }

      const result = yield* this.readCloudSuccessResponseEffect(response);

      yield* Effect.sync(() => {
        logger.transcription.info("Cloud transcription successful", {
          textLength: result.transcription.length,
          language: result.language,
          duration: result.duration,
          transcription: result.transcription,
        });
      });

      return {
        text: result.transcription,
        detectedLanguage: result.language,
      };
    }).pipe(Effect.ensuring(releaseRequest));
  }
}
