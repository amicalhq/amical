import { useState } from "react";
import { api } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";

export interface UseRecordingStateOutput {
  recordingState: RecordingState;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

export const useRecordingState = (): UseRecordingStateOutput => {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");

  console.log("recordingState", recordingState);

  const startRecordingMutation = api.recording.start.useMutation();
  const stopRecordingMutation = api.recording.stop.useMutation();

  // Subscribe to recording state updates via tRPC
  api.recording.stateUpdates.useSubscription(undefined, {
    onData: (state: RecordingState) => {
      console.log("recordingStatus", state);
      setRecordingState(state);
    },
    onError: (error) => {
      console.error("Error subscribing to recording state updates", error);
    },
  });

  const startRecording = async (): Promise<void> => {
    try {
      await startRecordingMutation.mutateAsync();
    } catch (error) {
      console.error("Failed to start recording via tRPC", error);
      throw error;
    }
  };

  const stopRecording = async (): Promise<void> => {
    try {
      await stopRecordingMutation.mutateAsync();
    } catch (error) {
      console.error("Failed to stop recording via tRPC", error);
      throw error;
    }
  };

  return {
    recordingState,
    startRecording,
    stopRecording,
  };
};
