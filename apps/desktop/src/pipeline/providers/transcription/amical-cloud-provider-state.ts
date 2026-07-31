import type { GetAccessibilityContextResult } from "@amical/types";
import { Context, Effect, Ref } from "effect";
import { AppError, ErrorCodes } from "../../../types/error";
import type { CloudFallbackStage } from "../../../types/telemetry-events";
import { detectApplicationType } from "../formatting/formatter-prompt";
import type {
  CloudDictationGrpcStream,
  GrpcStreamContext,
} from "./grpc-dictation-client";

export interface CloudAuth {
  isAuthenticated(): Effect.Effect<boolean, AppError>;
  getIdToken(): Effect.Effect<string | null, AppError>;
  refreshTokenIfNeeded(force?: boolean): Effect.Effect<void, AppError>;
}

export const CloudAuth = Context.GenericTag<CloudAuth>(
  "AmicalCloudProvider/CloudAuth",
);

export type Transport = "grpc" | "http";

export interface CloudConfig {
  apiEndpoint: string;
  transport: Transport;
}

export const CloudConfig = Context.GenericTag<CloudConfig>(
  "AmicalCloudProvider/CloudConfig",
);

type CloudProviderEnv = CloudAuth | CloudConfig;
export type CloudProviderEffect<A> = Effect.Effect<
  A,
  AppError,
  CloudProviderEnv
>;

export interface ProviderState {
  frameBuffer: Float32Array[];
  frameBufferSpeechProbabilities: number[];
  // Mirror of all audio fed during the gRPC path, so an HTTP fallback can
  // re-transcribe the full utterance (gRPC-streamed audio is otherwise lost
  // when the stream fails). Independent of frameBuffer; seeded into it on
  // fallback. Bounded to one session — see storeContextEffect / reset.
  sessionAudioBuffer: Float32Array[];
  sessionAudioVadProbs: number[];
  currentSilenceFrameCount: number;
  lastSpeechTimestamp: number;
  currentLanguages: string[];
  currentAccessibilityContext: GetAccessibilityContextResult | null;
  currentAggregatedTranscription: string | undefined;
  currentVocabulary: string[];
  currentSessionId: string | undefined;
  // Sticky per-session: send the "instruct" preset (cloud generation) instead
  // of formatting. Set from TranscribeContext.isInstruct in storeContextEffect.
  currentIsInstruct: boolean;
  // Labs tokens resolved once per session in storeContextEffect (a settings DB
  // read), so per-chunk transcribe()/flush() snapshots stay in-memory.
  currentEnabledLabs: string[];
  grpcStream: CloudDictationGrpcStream | null;
  grpcSentContextKey: string | null;
  grpcSentSkillsKey: string | null;
  grpcPendingFrames: Float32Array[];
  grpcPendingSampleCount: number;
  grpcNextSeq: bigint;
  grpcFallbackStage: CloudFallbackStage;
  // In-flight HTTP-fallback fetch aborter; reset() aborts it so a finalize-phase
  // dismiss can cancel an HTTP flush mid-request (gRPC uses stream.cancel()).
  httpAbortController: AbortController | null;
  // Sticky-within-session override: once gRPC fails with a transport-level
  // error, every subsequent transcribe()/flush() in the *same* dictation
  // session takes the HTTP path. Cleared when storeContextEffect sees a new
  // sessionId, and on reset()/dispose() — so a transient drop does not stick
  // for the rest of the app run.
  transportOverride: "http" | null;
}

export interface ProviderRequestSnapshot {
  currentLanguages: string[];
  currentAccessibilityContext: GetAccessibilityContextResult | null;
  currentAggregatedTranscription: string | undefined;
  currentVocabulary: string[];
  currentSessionId: string | undefined;
  currentIsInstruct: boolean;
  enabledLabs: string[];
}

export const projectAccessibilityContext = (
  ctx: GetAccessibilityContextResult | null,
): GrpcStreamContext | undefined => {
  if (!ctx) {
    return undefined;
  }

  return {
    selectedText: ctx.context?.textSelection?.selectedText ?? undefined,
    beforeText: ctx.context?.textSelection?.preSelectionText ?? undefined,
    afterText: ctx.context?.textSelection?.postSelectionText ?? undefined,
    appType: detectApplicationType(ctx),
    appBundleId: ctx.context?.application?.bundleIdentifier ?? undefined,
    appName: ctx.context?.application?.name ?? undefined,
    appUrl: ctx.context?.windowInfo?.url ?? undefined,
  };
};

export const toNetworkAppError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    error instanceof Error ? error.message : "Network error",
    ErrorCodes.NETWORK_ERROR,
  );
};

export const createInitialProviderState = (): ProviderState => ({
  frameBuffer: [],
  frameBufferSpeechProbabilities: [],
  sessionAudioBuffer: [],
  sessionAudioVadProbs: [],
  currentSilenceFrameCount: 0,
  lastSpeechTimestamp: 0,
  currentLanguages: [],
  currentAccessibilityContext: null,
  currentAggregatedTranscription: undefined,
  currentVocabulary: [],
  currentSessionId: undefined,
  currentIsInstruct: false,
  currentEnabledLabs: [],
  grpcStream: null,
  grpcSentContextKey: null,
  grpcSentSkillsKey: null,
  grpcPendingFrames: [],
  grpcPendingSampleCount: 0,
  grpcNextSeq: 1n,
  grpcFallbackStage: "transcribe",
  transportOverride: null,
  httpAbortController: null,
});

const requestSnapshotFromState = (
  state: ProviderState,
): ProviderRequestSnapshot => ({
  currentLanguages: state.currentLanguages,
  currentAccessibilityContext: state.currentAccessibilityContext,
  currentAggregatedTranscription: state.currentAggregatedTranscription,
  currentVocabulary: state.currentVocabulary,
  currentSessionId: state.currentSessionId,
  currentIsInstruct: state.currentIsInstruct,
  enabledLabs: state.currentEnabledLabs,
});

export const requestSnapshotEffect = (
  state: Ref.Ref<ProviderState>,
): CloudProviderEffect<ProviderRequestSnapshot> =>
  Ref.get(state).pipe(Effect.map(requestSnapshotFromState));

export const getIdTokenEffect = (): CloudProviderEffect<string> =>
  Effect.gen(function* () {
    const auth = yield* CloudAuth;
    const idToken = yield* auth.getIdToken();

    if (!idToken) {
      return yield* Effect.fail(
        new AppError(
          "No authentication token available",
          ErrorCodes.AUTH_REQUIRED,
        ),
      );
    }

    return idToken;
  });

export const resetProviderState = (): ProviderState =>
  createInitialProviderState();

export const resetGrpcState = (state: ProviderState): ProviderState => ({
  ...state,
  grpcStream: null,
  grpcSentContextKey: null,
  grpcSentSkillsKey: null,
  grpcPendingFrames: [],
  grpcPendingSampleCount: 0,
  grpcNextSeq: 1n,
  grpcFallbackStage: "transcribe",
});
