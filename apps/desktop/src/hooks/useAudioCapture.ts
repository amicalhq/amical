import { useRef, useEffect, useState, useCallback } from "react";
import audioWorkletUrl from "@/assets/audio-recorder-processor.js?url";
import { api } from "@/trpc/react";

// Audio configuration
const FRAME_SIZE = 512; // 32ms at 16kHz
const SAMPLE_RATE = 16000;

export interface UseAudioCaptureParams {
  onAudioChunk: (
    arrayBuffer: ArrayBuffer,
    speechProbability: number,
    isFinalChunk: boolean,
  ) => Promise<void> | void;
  enabled: boolean;
}

export interface UseAudioCaptureOutput {
  voiceDetected: boolean;
}

export const useAudioCapture = ({
  onAudioChunk,
  enabled,
}: UseAudioCaptureParams): UseAudioCaptureOutput => {
  const [voiceDetected, setVoiceDetected] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Subscribe to voice detection updates via tRPC
  api.recording.voiceDetectionUpdates.useSubscription(undefined, {
    enabled,
    onData: (detected: boolean) => {
      setVoiceDetected(detected);
    },
    onError: (err) => {
      console.error("Voice detection subscription error:", err);
    },
  });

  const startCapture = useCallback(async () => {
    try {
      console.log("AudioCapture: Starting audio capture");

      // Get microphone stream
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context
      audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });

      // Load audio worklet
      await audioContextRef.current.audioWorklet.addModule(audioWorkletUrl);

      // Create nodes
      sourceRef.current = audioContextRef.current.createMediaStreamSource(
        streamRef.current,
      );
      workletNodeRef.current = new AudioWorkletNode(
        audioContextRef.current,
        "audio-recorder-processor",
      );

      // Handle audio frames from worklet
      workletNodeRef.current.port.onmessage = async (event) => {
        if (event.data.type === "audioFrame") {
          const frame = event.data.frame;
          console.log("AudioCapture: Received frame", {
            frameLength: frame.length,
            isFinal: event.data.isFinal,
          });
          const isFinal = event.data.isFinal || false;

          // Convert to ArrayBuffer for IPC
          const arrayBuffer = frame.buffer.slice(
            frame.byteOffset,
            frame.byteOffset + frame.byteLength,
          );

          // Send to main process for VAD processing
          // Main process will update voice detection state
          await onAudioChunk(arrayBuffer, 0, isFinal); // Speech probability will come from main

          console.log(
            `AudioCapture: Sent frame: ${frame.length} samples, isFinal: ${isFinal}`,
          );
        }
      };

      // Connect audio graph
      sourceRef.current.connect(workletNodeRef.current);

      console.log("AudioCapture: Audio capture started");
    } catch (error) {
      console.error("AudioCapture: Failed to start capture:", error);
      throw error;
    }
  }, [onAudioChunk]);

  const stopCapture = useCallback(() => {
    console.log("AudioCapture: Stopping audio capture");

    // Send flush command to worklet before disconnecting
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "flush" });
      console.log("AudioCapture: Sent flush command to worklet");
    }

    // Disconnect nodes
    if (sourceRef.current && workletNodeRef.current) {
      sourceRef.current.disconnect(workletNodeRef.current);
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Clear refs
    audioContextRef.current = null;
    sourceRef.current = null;
    workletNodeRef.current = null;
    streamRef.current = null;

    setVoiceDetected(false);
    console.log("AudioCapture: Audio capture stopped");
  }, []);

  // Start/stop based on enabled state
  useEffect(() => {
    if (enabled) {
      startCapture().catch((error) => {
        console.error("AudioCapture: Failed to start:", error);
      });
    } else {
      stopCapture();
    }

    return () => {
      stopCapture();
    };
  }, [enabled, startCapture, stopCapture]);

  return {
    voiceDetected,
  };
};
