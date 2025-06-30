import { useState, useRef, useCallback, useEffect } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { audioRecorderWorkletSource } from "./audio-recorder-worklet";

export interface UseAudioCaptureParams {
  onAudioChunk: (
    arrayBuffer: ArrayBuffer,
    isFinalChunk: boolean,
  ) => Promise<void> | void;
  chunkDurationMs?: number;
  enabled: boolean;
}

export interface UseAudioCaptureOutput {
  voiceDetected: boolean;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
}

const cleanupMediaResources = (
  vadInstance: MicVAD | null,
  streamInstance: MediaStream | null,
) => {
  if (vadInstance) {
    try {
      vadInstance.destroy();
    } catch (e) {
      console.error("Error destroying VAD:", e);
    }
  }
  if (streamInstance) {
    streamInstance.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (e) {
        console.error("Error stopping stream track:", e);
      }
    });
  }
  console.log("Helper: Media resources cleaned up.");
};

export const useAudioCapture = ({
  onAudioChunk,
  chunkDurationMs = 28000,
  enabled,
}: UseAudioCaptureParams): UseAudioCaptureOutput => {
  const [voiceDetected, setVoiceDetected] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<MicVAD | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stopCapture = useCallback(async () => {
    console.log("AudioCapture: Stopping capture...");

    // Send final chunk if we have a send function
    const sendFinalChunk = (window as any).currentSendAudioChunk;
    if (sendFinalChunk) {
      await sendFinalChunk(true);
    }

    // Cleanup all resources
    cleanupMediaResources(vadRef.current, streamRef.current);

    // Clear Web Audio API resources
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    (window as any).currentWebAudioCleanup = null;
    (window as any).currentSendAudioChunk = null;

    vadRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    setVoiceDetected(false);

    console.log("AudioCapture: Stopped");
  }, []);

  const startCapture = useCallback(async () => {
    console.log("AudioCapture: Starting capture...");

    let localStream: MediaStream | null = null;
    let localVad: MicVAD | null = null;

    try {
      // Get microphone access
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = localStream;

      // Set up Web Audio API with AudioWorklet for raw PCM data
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      let audioWorkletNode: AudioWorkletNode | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let chunkTimer: NodeJS.Timeout | null = null;
      let pendingAudioChunks: Float32Array[] = [];

      // Load AudioWorklet module using blob URL
      const blob = new Blob([audioRecorderWorkletSource], {
        type: "application/javascript",
      });
      const audioWorkletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(audioWorkletUrl);
      URL.revokeObjectURL(audioWorkletUrl);
      console.log("AudioCapture: AudioWorklet module loaded");

      source = audioContext.createMediaStreamSource(localStream);

      // Create AudioWorklet node
      audioWorkletNode = new AudioWorkletNode(
        audioContext,
        "audio-recorder-processor",
      );

      // Handle messages from AudioWorklet
      audioWorkletNode.port.onmessage = (event) => {
        if (event.data.type === "audioData") {
          const audioData = event.data.audioData as Float32Array;
          const isFinal = event.data.isFinal as boolean;

          // Store the audio chunk
          pendingAudioChunks.push(audioData);

          if (isFinal) {
            // Send final chunk immediately
            sendAudioChunk(true);
          }
        }
      };

      // Create function to send accumulated chunks
      const sendAudioChunk = async (isFinal = false) => {
        if (pendingAudioChunks.length > 0) {
          // Combine all pending chunks into one array
          const totalLength = pendingAudioChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
          );
          const combinedChunk = new Float32Array(totalLength);
          let offset = 0;

          for (const chunk of pendingAudioChunks) {
            combinedChunk.set(chunk, offset);
            offset += chunk.length;
          }

          // Convert Float32Array to ArrayBuffer for IPC
          const arrayBuffer = combinedChunk.buffer.slice(
            combinedChunk.byteOffset,
            combinedChunk.byteOffset + combinedChunk.byteLength,
          );

          try {
            await onAudioChunk(arrayBuffer, isFinal);
            console.log(
              `AudioCapture: Sent chunk: ${combinedChunk.length} samples, final: ${isFinal}`,
            );
          } catch (error) {
            console.error("AudioCapture: Error processing chunk:", error);
          }

          pendingAudioChunks = []; // Clear chunks after sending
        }
      };

      // Set up periodic chunk sending
      chunkTimer = setInterval(() => {
        sendAudioChunk(false);
      }, chunkDurationMs);

      // Connect the audio processing chain
      source.connect(audioWorkletNode);
      console.log("AudioCapture: Connected AudioWorklet processing chain");

      // Store cleanup function
      const cleanup = () => {
        if (chunkTimer) {
          clearInterval(chunkTimer);
          chunkTimer = null;
        }
        if (audioWorkletNode) {
          // Send stop command to worklet
          audioWorkletNode.port.postMessage({ command: "stop" });
          audioWorkletNode.disconnect();
          audioWorkletNode = null;
        }
        if (source) {
          source.disconnect();
          source = null;
        }
        if (audioContext && audioContext.state !== "closed") {
          audioContext.close();
        }
        console.log("AudioCapture: Cleaned up AudioWorklet resources");
      };

      cleanupRef.current = cleanup;
      // Store references for cleanup and final chunk sending
      (window as any).currentWebAudioCleanup = cleanup;
      (window as any).currentSendAudioChunk = sendAudioChunk;

      console.log(
        `AudioCapture: AudioWorklet recording started, chunk duration ${chunkDurationMs}ms`,
      );

      // Set up VAD
      localVad = await MicVAD.new({
        stream: localStream,
        model: "v5",
        onSpeechStart: () => {
          console.log("VAD: Speech started");
          setVoiceDetected(true);
        },
        onSpeechEnd: () => {
          console.log("VAD: Speech ended");
          setVoiceDetected(false);
        },
      });
      vadRef.current = localVad;
      localVad.start();
      console.log("AudioCapture: VAD started");

      console.log("AudioCapture: Fully started");
    } catch (err) {
      console.error("AudioCapture: Error starting:", err);
      cleanupMediaResources(localVad, localStream);
      streamRef.current = null;
      vadRef.current = null;
      setVoiceDetected(false);
      throw err;
    }
  }, [onAudioChunk, chunkDurationMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("AudioCapture: Unmounting...");
      const str = streamRef.current;
      const vad = vadRef.current;

      cleanupMediaResources(vad, str);

      if (cleanupRef.current) {
        cleanupRef.current();
        (window as any).currentWebAudioCleanup = null;
        (window as any).currentSendAudioChunk = null;
      }

      streamRef.current = null;
      vadRef.current = null;
      console.log("AudioCapture: Unmount cleanup finished");
    };
  }, []);

  return {
    voiceDetected,
    startCapture,
    stopCapture,
  };
};
