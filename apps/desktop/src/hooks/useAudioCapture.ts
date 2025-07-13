import { useRef, useEffect, useState, useCallback } from "react";
import audioWorkletUrl from "@/assets/audio-recorder-processor.js?url";
import { api } from "@/trpc/react";
import { Mutex } from "async-mutex";

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
  const mutexRef = useRef(new Mutex());

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

  // Get user's preferred microphone from settings
  const { data: settings } = api.settings.getSettings.useQuery();
  const preferredMicrophoneName = settings?.recording?.preferredMicrophoneName;

  const startCapture = useCallback(async () => {
    await mutexRef.current.runExclusive(async () => {
      try {
        console.log("AudioCapture: Starting audio capture");

        // Build audio constraints
        const audioConstraints: MediaTrackConstraints = {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };

        // Add deviceId if user has a preference
        if (preferredMicrophoneName) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const preferredDevice = devices.find(
            (device) =>
              device.kind === "audioinput" &&
              device.label === preferredMicrophoneName,
          );
          if (preferredDevice) {
            audioConstraints.deviceId = { exact: preferredDevice.deviceId };
            console.log(
              "AudioCapture: Using preferred microphone:",
              preferredMicrophoneName,
            );
          }
        }

        // Get microphone stream
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
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
            console.debug("AudioCapture: Received frame", {
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
          }
        };

        // Connect audio graph
        sourceRef.current.connect(workletNodeRef.current);

        console.log("AudioCapture: Audio capture started");
      } catch (error) {
        console.error("AudioCapture: Failed to start capture:", error);
        throw error;
      }
    });
  }, [onAudioChunk, preferredMicrophoneName]);

  const stopCapture = useCallback(async () => {
    await mutexRef.current.runExclusive(async () => {
      try {
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
        if (
          audioContextRef.current &&
          audioContextRef.current.state !== "closed"
        ) {
          await audioContextRef.current.close();
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

        console.log("AudioCapture: Audio capture stopped");
      } catch (error) {
        console.error("AudioCapture: Error during stop:", error);
        throw error;
      }
    });
  }, []);

  // Start/stop based on enabled state
  useEffect(() => {
    if (!enabled) {
      return;
    }

    startCapture().catch((error) => {
      console.error("AudioCapture: Failed to start:", error);
    });

    return () => {
      stopCapture().catch((error) => {
        console.error("AudioCapture: Failed to stop:", error);
      });
    };
  }, [enabled, startCapture, stopCapture]);

  return {
    voiceDetected,
  };
};
