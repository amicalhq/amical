import { useCallback } from "react";
import { useRecordingState } from "./useRecordingState";
import { useAudioCapture } from "./useAudioCapture";
import type { RecordingState } from "@/types/recording";

export interface UseRecordingParams {
  onAudioFrame: (
    audioBuffer: ArrayBuffer,
    speechProbability: number,
    isFinal: boolean,
  ) => Promise<void> | void;
  onRecordingStartCallback?: () => Promise<void> | void;
  onRecordingStopCallback?: () => Promise<void> | void;
}

export interface UseRecordingOutput {
  recordingStatus: RecordingState;
  voiceDetected: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

export const useRecording = ({
  onAudioFrame,
  onRecordingStartCallback,
  onRecordingStopCallback,
}: UseRecordingParams): UseRecordingOutput => {
  // Manage recording state via tRPC
  const {
    recordingStatus,
    startRecording: startRecordingMutation,
    stopRecording: stopRecordingMutation,
  } = useRecordingState();

  // Create handler for audio chunks - just pass through
  const handleAudioChunk = useCallback(
    async (
      arrayBuffer: ArrayBuffer,
      speechProbability: number,
      isFinalChunk: boolean,
    ) => {
      // Direct pass-through - no aggregation needed
      await onAudioFrame(arrayBuffer, speechProbability, isFinalChunk);
    },
    [onAudioFrame],
  );

  // Manage audio capture when recording is active
  const isActive =
    recordingStatus === "recording" || recordingStatus === "starting";

  const { voiceDetected } = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    enabled: isActive,
  });

  const startRecording = useCallback(async () => {
    // Check if already recording
    if (recordingStatus !== "idle" && recordingStatus !== "error") {
      console.log(`Hook: Start denied. Current status: ${recordingStatus}`);
      return;
    }

    try {
      // Request main process to start recording
      const status = await startRecordingMutation();

      // If main process failed to start, abort
      if (status.state !== "recording" && status.state !== "starting") {
        console.error(
          "Hook: Main process failed to start recording",
          status.error,
        );
        return;
      }

      // Call start callback if provided
      if (onRecordingStartCallback) {
        await onRecordingStartCallback();
        console.log("Hook: onRecordingStartCallback executed.");
      }

      console.log("Hook: Recording fully started");
    } catch (error) {
      console.error("Hook: Error starting recording:", error);

      // Try to stop recording in main process
      try {
        await stopRecordingMutation();
      } catch (stopError) {
        console.error("Hook: Failed to stop recording after error", stopError);
      }

      // Call stop callback if start callback was called
      if (onRecordingStopCallback) {
        try {
          await onRecordingStopCallback();
        } catch (e) {
          console.error(
            "Hook: Error in onRecordingStopCallback during start error:",
            e,
          );
        }
      }
    }
  }, [
    recordingStatus,
    startRecordingMutation,
    onRecordingStartCallback,
    onRecordingStopCallback,
    stopRecordingMutation,
  ]);

  const stopRecording = useCallback(async () => {
    // Check if recording
    if (recordingStatus !== "recording" && recordingStatus !== "starting") {
      console.log(`Hook: Stop called but status is ${recordingStatus}.`);
      return;
    }

    try {
      // Request main process to stop recording
      await stopRecordingMutation();

      // Call stop callback if provided
      if (onRecordingStopCallback) {
        await onRecordingStopCallback();
        console.log("Hook: onRecordingStopCallback executed.");
      }

      console.log("Hook: Recording stopped");
    } catch (error) {
      console.error("Hook: Error stopping recording:", error);
    }
  }, [
    recordingStatus,
    stopRecordingMutation,
    onRecordingStopCallback,
    onAudioFrame,
  ]);

  return {
    recordingStatus,
    voiceDetected,
    startRecording,
    stopRecording,
  };
};
