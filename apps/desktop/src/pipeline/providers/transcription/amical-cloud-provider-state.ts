import type { GetAccessibilityContextResult } from "@amical/types";
import { Context, Effect, Ref } from "effect";
import {
  AuthRequired,
  NetworkFailure,
  isCloudError,
  type CloudError,
} from "../../../types/errors";
import type { CloudFallbackStage } from "../../../types/telemetry-events";
import { detectApplicationType } from "../formatting/formatter-prompt";
import type {
  CloudDictationGrpcStream,
  GrpcStreamContext,
} from "./grpc-dictation-client";

export interface CloudAuth {
  isAuthenticated(): Effect.Effect<boolean, CloudError>;
  getIdToken(): Effect.Effect<string | null, CloudError>;
  refreshTokenIfNeeded(force?: boolean): Effect.Effect<void, CloudError>;
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
  CloudError,
  CloudProviderEnv
>;

export interface ProviderState {
  frameBuffer: Float32Array[];
  frameBufferSpeechProbabilities: number[];
  // Mirror of all audio fed during the gRPC path, so an HTTP fallback can
  // re-transcribe the full utterance (gRPC-streamed audio is otherwise lost
  // when the stream fails). Independent of frameBuffer; seeded into it on
  // fallback. This state belongs to exactly one AmicalCloudSession.
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
  // In-flight HTTP-fallback fetch aborter; cancellation aborts it so a
  // finalize-phase dismiss can cancel an HTTP flush mid-request (gRPC uses
  // stream.cancel()).
  httpAbortController: AbortController | null;
  // Sticky-within-session override: once gRPC fails with a transport-level
  // error, every subsequent transcribe()/flush() in the *same* dictation
  // session takes the HTTP path. The state is discarded on cancellation or
  // disposal, so a transient drop does not stick for the rest of the app run.
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

export const toNetworkFailure = (error: unknown): CloudError => {
  if (isCloudError(error)) {
    return error;
  }

  return new NetworkFailure({
    message: error instanceof Error ? error.message : "Network error",
    cause: error,
  });
};

/**
 * Pass-through/die refinement for lifts around the gRPC client: the client
 * throws cloud variants; anything else is a programming defect. Foreign
 * values must NOT become NetworkFailure here — a bug is not a retryable
 * network condition.
 */
export const cloudFailOrDie = (
  error: unknown,
): Effect.Effect<never, CloudError> =>
  isCloudError(error) ? Effect.fail(error) : Effect.die(error);

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
        new AuthRequired({ message: "No authentication token available" }),
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
