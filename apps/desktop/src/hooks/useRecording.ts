import { useCallback } from "react";
import { useRecordingState } from "./useRecordingState";
import { useAudioCapture } from "./useAudioCapture";
import type { RecordingState } from "@/types/recording";

export interface UseRecordingParams {
  onAudioChunk: (
    arrayBuffer: ArrayBuffer,
    isFinalChunk: boolean,
  ) => Promise<void> | void;
  chunkDurationMs?: number;
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
  onAudioChunk,
  chunkDurationMs = 28000,
  onRecordingStartCallback,
  onRecordingStopCallback,
}: UseRecordingParams): UseRecordingOutput => {
  // Manage recording state via tRPC
  const {
    recordingStatus,
    startRecording: startRecordingMutation,
    stopRecording: stopRecordingMutation,
  } = useRecordingState();

  // Manage audio capture when recording is active
  const isActive =
    recordingStatus === "recording" || recordingStatus === "starting";

  const { voiceDetected, startCapture, stopCapture } = useAudioCapture({
    onAudioChunk,
    chunkDurationMs,
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

      // Start audio capture
      await startCapture();
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
    startCapture,
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
      // Stop audio capture first to send final chunk
      await stopCapture();

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
    stopCapture,
    stopRecordingMutation,
    onRecordingStopCallback,
  ]);

  return {
    recordingStatus,
    voiceDetected,
    startRecording,
    stopRecording,
  };
};
