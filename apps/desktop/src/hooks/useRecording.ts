import { useCallback, useState } from "react";
import { useAudioCapture } from "./useAudioCapture";
import { api } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";
import type { RecordingMode } from "@/main/managers/recording-manager";

export interface RecordingStatus {
  state: RecordingState;
  mode: RecordingMode;
}

export interface UseRecordingOutput {
  recordingStatus: RecordingStatus;
  voiceDetected: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

export const useRecording = (): UseRecordingOutput => {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({
    state: "idle",
    mode: "idle",
  });

  const startRecordingMutation = api.recording.signalStart.useMutation();
  const stopRecordingMutation = api.recording.signalStop.useMutation();

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
      arrayBuffer: ArrayBuffer,
      speechProbability: number,
      isFinalChunk: boolean,
    ) => {
      // Convert ArrayBuffer to Float32Array
      const float32Array = new Float32Array(arrayBuffer);

      // Send frame directly to main process
      // TODO: We need to update the IPC to include speech detection info
      await window.electronAPI.sendAudioChunk(float32Array, isFinalChunk);
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

  // Manage audio capture when recording is active
  const isActive = recordingStatus.state === "recording";

  const { voiceDetected } = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    enabled: isActive,
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

  return {
    recordingStatus,
    voiceDetected,
    startRecording,
    stopRecording,
  };
};
