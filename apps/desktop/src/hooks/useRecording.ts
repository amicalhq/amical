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
  recordingState: RecordingState;
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
    recordingState,
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
    recordingState === "recording" || recordingState === "starting";

  const { voiceDetected } = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    enabled: isActive,
  });

  const startRecording = useCallback(async () => {
    // Check if already recording
    if (recordingState !== "idle" && recordingState !== "error") {
      console.log(`Hook: Start denied. Current status: ${recordingState}`);
      return;
    }

    try {
      // Request main process to start recording
      await startRecordingMutation();

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
    recordingState,
    startRecordingMutation,
    onRecordingStartCallback,
    onRecordingStopCallback,
    stopRecordingMutation,
  ]);

  const stopRecording = useCallback(async () => {
    // Check if recording
    if (recordingState !== "recording" && recordingState !== "starting") {
      console.log(`Hook: Stop called but status is ${recordingState}.`);
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
    recordingState,
    stopRecordingMutation,
    onRecordingStopCallback,
    onAudioFrame,
  ]);

  return {
    recordingState,
    voiceDetected,
    startRecording,
    stopRecording,
  };
};
