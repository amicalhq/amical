import { useState, useEffect } from "react";
import { api } from "@/trpc/react";
import type { RecordingState, RecordingStatus } from "@/types/recording";

export interface UseRecordingStateOutput {
  recordingStatus: RecordingState;
  startRecording: () => Promise<RecordingStatus>;
  stopRecording: () => Promise<RecordingStatus>;
}

export const useRecordingState = (): UseRecordingStateOutput => {
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingState>("idle");

  console.log("recordingStatus", recordingStatus);

  const startRecordingMutation = api.recording.start.useMutation();
  const stopRecordingMutation = api.recording.stop.useMutation();

  // Subscribe to recording state updates via tRPC
  api.recording.stateUpdates.useSubscription(undefined, {
    onData: (status: RecordingStatus) => {
      console.log("recordingStatus", status);
      setRecordingStatus(status.state);
    },
    onError: (error) => {
      console.error("Error subscribing to recording state updates", error);
    },
  });

  const startRecording = async (): Promise<RecordingStatus> => {
    try {
      const status = await startRecordingMutation.mutateAsync();
      return status;
    } catch (error) {
      console.error("Failed to start recording via tRPC", error);
      throw error;
    }
  };

  const stopRecording = async (): Promise<RecordingStatus> => {
    try {
      const status = await stopRecordingMutation.mutateAsync();
      return status;
    } catch (error) {
      console.error("Failed to stop recording via tRPC", error);
      throw error;
    }
  };

  return {
    recordingStatus,
    startRecording,
    stopRecording,
  };
};
