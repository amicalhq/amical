import { useCallback, useState } from "react";
import { useAudioCapture } from "./useAudioCapture";
import type { AcquiredMicrophoneMetadata } from "./audioCaptureDevice";
import { api } from "@/trpc/react";
import type {
  CaptureStartFailure,
  RecordingMode,
  RecordingState,
} from "@/types/recording";

export interface RecordingStatus {
  sessionId: string | null;
  state: RecordingState;
  mode: RecordingMode;
  isDraft: boolean;
  /** Dismiss-vs-finalize while stopping; "none" outside stopping. */
  stopKind: "none" | "dismiss" | "finalize";
  stopOrigin: "none" | "user" | "auto";
}

export interface UseRecordingOutput {
  recordingStatus: RecordingStatus;
  /** Per-bar levels (0..1): scrolling history of mic loudness for the bars. */
  audioLevels: number[];
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  dismissRecording: () => Promise<void>;
}

export const useRecording = (): UseRecordingOutput => {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({
    sessionId: null,
    state: "idle",
    mode: "ptt",
    isDraft: false,
    stopKind: "none",
    stopOrigin: "none",
  });

  const startRecordingMutation = api.recording.signalStart.useMutation();
  const stopRecordingMutation = api.recording.signalStop.useMutation();
  const dismissRecordingMutation = api.recording.dismiss.useMutation();
  const captureStartedMutation = api.recording.captureStarted.useMutation();
  const captureStartFailedMutation =
    api.recording.captureStartFailed.useMutation();

  // Subscribe to recording state updates via tRPC
  api.recording.stateUpdates.useSubscription(undefined, {
    onData: (update) => {
      setRecordingStatus(update);
    },
    onError: (error) => {
      console.error("Error subscribing to recording state updates", error);
    },
  });

  // Handle audio frames by sending them to the main process
  const handleAudioChunk = useCallback(
    async (
      sessionId: string,
      arrayBuffer: ArrayBuffer,
      speechProbability: number,
      isFinalChunk: boolean,
    ) => {
      // Convert ArrayBuffer to Float32Array
      const float32Array = new Float32Array(arrayBuffer);

      // Send frame directly to main process
      // TODO: We need to update the IPC to include speech detection info
      await window.electronAPI.sendAudioChunk(
        sessionId,
        float32Array,
        isFinalChunk,
      );
      console.debug(`Sent audio frame`, {
        samples: float32Array.length,
        speechProbability: speechProbability.toFixed(3),
        isFinal: isFinalChunk,
      });

      if (isFinalChunk) {
        console.log("Final frame sent to main process");
      }
    },
    [],
  );

  const handleCaptureStarted = useCallback(
    (microphone: AcquiredMicrophoneMetadata, sessionId: string) => {
      captureStartedMutation.mutate(
        {
          sessionId,
          microphoneName: microphone.name,
          captureSource: microphone.captureSource,
        },
        {
          onError: (error) => {
            console.warn("Failed to report active microphone", error);
          },
        },
      );
    },
    [captureStartedMutation],
  );

  const handleCaptureStartFailure = useCallback(
    (failure: CaptureStartFailure) => {
      captureStartFailedMutation.mutate(failure, {
        onError: (error) => {
          console.warn("Failed to report microphone capture failure", error);
        },
      });
    },
    [captureStartFailedMutation],
  );

  // Capture spins up at "starting" and confirms via captureStarted —
  // public "recording" means capture-confirmed.
  const isActive =
    recordingStatus.state === "starting" ||
    recordingStatus.state === "recording";
  const isIdle = recordingStatus.state === "idle";

  const { audioLevels } = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    onCaptureStarted: handleCaptureStarted,
    onCaptureStartFailure: handleCaptureStartFailure,
    sessionId: recordingStatus.sessionId,
    enabled: isActive,
    idle: isIdle,
  });

  const startRecording = useCallback(async () => {
    const mutationStartTime = performance.now();
    console.log("Hook: Calling startRecording mutation");
    // Request main process to start recording
    await startRecordingMutation.mutateAsync();
    const mutationDuration = performance.now() - mutationStartTime;
    console.log(
      `Hook: startRecording mutation took ${mutationDuration.toFixed(2)}ms`,
    );
    console.log("Hook: Recording fully started");
  }, [startRecordingMutation]);

  const stopRecording = useCallback(async () => {
    await stopRecordingMutation.mutateAsync();
    console.log("Hook: Recording stopped");
  }, [stopRecordingMutation]);

  const dismissRecording = useCallback(async () => {
    await dismissRecordingMutation.mutateAsync();
    console.log("Hook: Recording dismissed");
  }, [dismissRecordingMutation]);

  return {
    recordingStatus,
    audioLevels,
    startRecording,
    stopRecording,
    dismissRecording,
  };
};
