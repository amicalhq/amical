import { Effect, Ref } from "effect";
import type {
  TranscribeContext,
  TranscriptionOutput,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { NetworkFailure, type CloudError } from "../../../types/errors";
import { getAmicalClientInfo, getUserAgent } from "../../../utils/http-client";
import {
  CloudConfig,
  cloudFailOrDie,
  getIdTokenEffect,
  projectAccessibilityContext,
  requestSnapshotEffect,
  resetGrpcState,
  type CloudProviderEffect,
  type ProviderRequestSnapshot,
  type ProviderState,
} from "./amical-cloud-provider-state";
import {
  CloudDictationGrpcStream,
  type GrpcStreamContext,
} from "./grpc-dictation-client";
import { float32ToPcmS16le } from "../../utils/pcm-encoding";
import { resolveSessionSkills } from "./skill-resolution";

const snapshotKey = (value: unknown): string => JSON.stringify(value);

const contextSnapshotKey = (
  context: GrpcStreamContext | undefined,
): string | null => (context ? snapshotKey(context) : null);

export interface ObservedGrpcStreamFailure {
  stream: CloudDictationGrpcStream;
  /** The settled client value: a cloud variant, or a foreign defect. */
  error: unknown;
}

/** Owns the mechanics of the cloud gRPC route for one provider session. */
export class AmicalCloudGrpcTransport {
  constructor(
    private readonly state: Ref.Ref<ProviderState>,
    private readonly failIfClosedEffect: () => Effect.Effect<void, CloudError>,
    private readonly onStreamFailure: (
      failure: ObservedGrpcStreamFailure,
    ) => void,
  ) {}

  transcribeGrpcEffect(
    audioData: Float32Array,
    context: TranscribeContext,
  ): CloudProviderEffect<TranscriptionOutput> {
    if (audioData.length === 0) {
      return Effect.succeed({ text: "" });
    }

    return Effect.gen(this, function* () {
      yield* this.enqueueGrpcAudioEffect(audioData);
      yield* this.ensureGrpcStreamEffect(context.formattingEnabled ?? false);
      yield* this.sendReadyGrpcPacketsEffect(false);
      return { text: "" };
    }).pipe(
      Effect.catchAll((error) =>
        this.resetGrpcStreamEffect().pipe(Effect.zipRight(Effect.fail(error))),
      ),
    );
  }

  updateOpenStreamEffect(enableFormatting: boolean): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const stream = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcStream),
      );
      if (!stream) {
        return;
      }

      yield* this.sendGrpcSessionUpdatesEffect(stream, enableFormatting);
    });
  }

  flushGrpcEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<TranscriptionOutput> {
    return Effect.gen(this, function* () {
      yield* this.markGrpcFlushStageEffect();
      const state = yield* Ref.get(this.state);
      if (state.transportOverride === "http") {
        return yield* Effect.fail(this.routeChangedError());
      }
      if (!state.grpcStream && state.grpcPendingSampleCount === 0) {
        return { text: "" };
      }

      return yield* this.finalizeGrpcStreamEffect(enableFormatting).pipe(
        Effect.map((result) => ({
          text: result.formattedTranscript || result.rawTranscript,
        })),
        Effect.ensuring(this.clearGrpcAudioStateEffect()),
      );
    });
  }

  private finalizeGrpcStreamEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<{
    rawTranscript: string;
    formattedTranscript: string;
  }> {
    return Effect.gen(this, function* () {
      const stream = yield* this.ensureGrpcStreamEffect(enableFormatting);
      // Final re-sync: flush any context/skills change that landed since the
      // last push but wasn't sent (e.g. a dropped mid-session push). The server
      // formats the final transcript against the latest snapshot, so this is
      // the one place it has to be current. Dedup keys make it a no-op when the
      // pushes already landed.
      yield* this.sendGrpcSessionUpdatesEffect(stream, enableFormatting);
      yield* this.sendReadyGrpcPacketsEffect(true);

      const result = yield* Effect.tryPromise({
        try: () => stream.finalize(),
        catch: (error) => error,
      }).pipe(Effect.catchAll(cloudFailOrDie));
      yield* this.clearSuccessfulGrpcMirrorEffect(stream);
      return result;
    });
  }

  private ensureGrpcStreamEffect(
    enableFormatting: boolean,
  ): CloudProviderEffect<CloudDictationGrpcStream> {
    return Effect.gen(this, function* () {
      yield* this.failIfClosedEffect();
      const initialState = yield* Ref.get(this.state);
      if (initialState.transportOverride === "http") {
        return yield* Effect.fail(this.routeChangedError());
      }
      const existingStream = initialState.grpcStream;
      // Pure get-or-create: mid-session context/skills changes are pushed by
      // updateSessionContext, and a final re-sync happens in
      // finalizeGrpcStreamEffect. Don't re-send snapshots from here, or every
      // chunk (and every audio packet) pays for a snapshot diff.
      if (existingStream) {
        return existingStream;
      }

      const config = yield* CloudConfig;
      const snapshot = yield* requestSnapshotEffect(this.state);
      const idToken = yield* getIdTokenEffect();
      yield* this.failIfClosedEffect();
      const sessionId =
        snapshot.currentSessionId || `cloud-${Date.now().toString(36)}`;
      // Instruct uses its preset; formatting off produces no skills. Otherwise
      // the foreground app maps to a preset, with tone added only when
      // personalization is enabled. See skill-resolution.ts.
      const resolvedSkills = yield* Effect.promise(() =>
        resolveSessionSkills({
          isInstruct: snapshot.currentIsInstruct,
          enableFormatting,
          accessibilityContext: snapshot.currentAccessibilityContext,
        }),
      );
      yield* this.failIfClosedEffect();
      const streamContext = this.buildGrpcStreamContext(snapshot);
      const sentContextKey = contextSnapshotKey(streamContext);
      const sentSkillsKey = snapshotKey(resolvedSkills);
      const openOptions = {
        endpoint: config.apiEndpoint,
        token: idToken,
        userAgent: getUserAgent(),
        clientInfo: getAmicalClientInfo(),
        sessionId,
        languages: snapshot.currentLanguages,
        vocabulary: snapshot.currentVocabulary,
        formatting: enableFormatting,
        resolvedSkills,
        context: streamContext,
        labs: snapshot.enabledLabs,
      };

      const stream = yield* Effect.try({
        try: () => new CloudDictationGrpcStream(openOptions),
        catch: (error) => error,
      }).pipe(Effect.catchAll(cloudFailOrDie));
      const selectedStream = yield* Ref.modify(this.state, (state) => {
        if (state.transportOverride === "http") {
          return [null, state] as const;
        }
        if (state.grpcStream) {
          return [state.grpcStream, state] as const;
        }

        return [
          stream,
          {
            ...state,
            grpcStream: stream,
            grpcFallbackStage: "transcribe",
            grpcSentContextKey: sentContextKey,
            grpcSentSkillsKey: sentSkillsKey,
          },
        ] as const;
      });
      if (!selectedStream) {
        yield* Effect.sync(() => stream.cancel());
        return yield* Effect.fail(this.routeChangedError());
      }
      if (selectedStream !== stream) {
        yield* Effect.sync(() => stream.cancel());
        return selectedStream;
      }

      this.observeStreamFailure(stream);

      yield* Effect.sync(() => {
        logger.transcription.info("Cloud gRPC stream opened", {
          endpoint: config.apiEndpoint,
          sessionId,
          languages: snapshot.currentLanguages,
          vocabularySize: snapshot.currentVocabulary.length,
          formatting: enableFormatting,
          instruct: snapshot.currentIsInstruct,
        });
      });

      return stream;
    });
  }

  private sendGrpcSessionUpdatesEffect(
    stream: CloudDictationGrpcStream,
    enableFormatting: boolean,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const snapshot = yield* requestSnapshotEffect(this.state);
      const streamContext = this.buildGrpcStreamContext(snapshot);
      const nextContextKey = contextSnapshotKey(streamContext);
      const sentContextKey = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcSentContextKey),
      );

      if (streamContext && nextContextKey !== sentContextKey) {
        yield* Effect.tryPromise({
          try: () => stream.sendContextUpdate(streamContext),
          catch: (error) => error,
        }).pipe(Effect.catchAll(cloudFailOrDie));
        yield* Ref.update(this.state, (state) => ({
          ...state,
          grpcSentContextKey: nextContextKey,
        }));
      }

      yield* this.failIfClosedEffect();
      const resolvedSkills = yield* Effect.promise(() =>
        resolveSessionSkills({
          isInstruct: snapshot.currentIsInstruct,
          enableFormatting,
          accessibilityContext: snapshot.currentAccessibilityContext,
        }),
      );
      yield* this.failIfClosedEffect();
      const nextSkillsKey = snapshotKey(resolvedSkills);
      const sentSkillsKey = yield* Ref.get(this.state).pipe(
        Effect.map((state) => state.grpcSentSkillsKey),
      );

      if (nextSkillsKey !== sentSkillsKey) {
        yield* Effect.tryPromise({
          try: () => stream.sendSkillsUpdate(resolvedSkills),
          catch: (error) => error,
        }).pipe(Effect.catchAll(cloudFailOrDie));
        yield* Ref.update(this.state, (state) => ({
          ...state,
          grpcSentSkillsKey: nextSkillsKey,
        }));
      }
    });
  }

  private enqueueGrpcAudioEffect(
    audioData: Float32Array,
  ): CloudProviderEffect<void> {
    if (audioData.length === 0) {
      return Effect.void;
    }

    return Ref.update(this.state, (state) => ({
      ...state,
      grpcPendingFrames: [...state.grpcPendingFrames, audioData],
      grpcPendingSampleCount: state.grpcPendingSampleCount + audioData.length,
    }));
  }

  private takeGrpcPacketEffect(
    padFinalPacket: boolean,
  ): CloudProviderEffect<Float32Array | null> {
    const packetSamples = CloudDictationGrpcStream.PACKET_SAMPLES;
    return Ref.modify(this.state, (state) => {
      if (
        state.grpcPendingSampleCount < packetSamples &&
        !(padFinalPacket && state.grpcPendingSampleCount > 0)
      ) {
        return [null, state] as const;
      }

      const packet = new Float32Array(packetSamples);
      let written = 0;
      let grpcPendingSampleCount = state.grpcPendingSampleCount;
      const grpcPendingFrames = [...state.grpcPendingFrames];

      while (written < packetSamples && grpcPendingFrames.length > 0) {
        const frame = grpcPendingFrames[0]!;
        const samplesNeeded = packetSamples - written;
        const samplesToCopy = Math.min(frame.length, samplesNeeded);

        packet.set(frame.subarray(0, samplesToCopy), written);
        written += samplesToCopy;

        if (samplesToCopy === frame.length) {
          grpcPendingFrames.shift();
        } else {
          grpcPendingFrames[0] = frame.subarray(samplesToCopy);
        }

        grpcPendingSampleCount -= samplesToCopy;
      }

      return [
        packet,
        {
          ...state,
          grpcPendingFrames,
          grpcPendingSampleCount,
        },
      ] as const;
    });
  }

  private sendReadyGrpcPacketsEffect(
    padFinalPacket: boolean,
  ): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      while (true) {
        const packet = yield* this.takeGrpcPacketEffect(padFinalPacket);
        if (!packet) {
          return;
        }

        yield* this.sendGrpcPacketEffect(float32ToPcmS16le(packet));
      }
    });
  }

  private sendGrpcPacketEffect(packet: Uint8Array): CloudProviderEffect<void> {
    return Effect.gen(this, function* () {
      const stream = yield* this.ensureGrpcStreamEffect(false);
      const seq = yield* Ref.modify(this.state, (state) => [
        state.grpcNextSeq,
        {
          ...state,
          grpcNextSeq: state.grpcNextSeq + 1n,
        },
      ]);
      yield* Effect.tryPromise({
        try: () => stream.sendAudioBatch(seq, [packet]),
        catch: (error) => error,
      }).pipe(Effect.catchAll(cloudFailOrDie));
    });
  }

  private buildGrpcStreamContext(
    snapshot: ProviderRequestSnapshot,
  ): GrpcStreamContext | undefined {
    return projectAccessibilityContext(snapshot.currentAccessibilityContext);
  }

  private resetGrpcStreamEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const stream = yield* Ref.modify(this.state, (state) => [
        state.grpcStream,
        resetGrpcState(state),
      ]);
      yield* Effect.sync(() => stream?.cancel());
    });
  }

  private clearGrpcAudioStateEffect(): Effect.Effect<void> {
    return Ref.update(this.state, resetGrpcState);
  }

  private observeStreamFailure(stream: CloudDictationGrpcStream): void {
    void stream.finalTranscript.catch((error: unknown) => {
      try {
        this.onStreamFailure({ stream, error });
      } catch (observerError) {
        logger.transcription.error(
          "Failed to observe cloud gRPC stream failure",
          observerError,
        );
      }
    });
  }

  private markGrpcFlushStageEffect(): CloudProviderEffect<void> {
    return Ref.update(
      this.state,
      (state): ProviderState =>
        state.transportOverride === "http"
          ? state
          : { ...state, grpcFallbackStage: "flush" },
    );
  }

  private clearSuccessfulGrpcMirrorEffect(
    stream: CloudDictationGrpcStream,
  ): Effect.Effect<void> {
    return Ref.update(this.state, (state) =>
      state.grpcStream === stream
        ? {
            ...state,
            sessionAudioBuffer: [],
            sessionAudioVadProbs: [],
          }
        : state,
    );
  }

  private routeChangedError(): CloudError {
    return new NetworkFailure({
      message: "gRPC route changed before the operation completed",
    });
  }
}
