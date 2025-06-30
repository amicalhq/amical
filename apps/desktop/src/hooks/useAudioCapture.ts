import { useState, useRef, useEffect } from "react";
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
}

interface AudioCaptureState {
  stream: MediaStream | null;
  vad: MicVAD | null;
  audioContext: AudioContext | null;
  audioWorkletNode: AudioWorkletNode | null;
  source: MediaStreamAudioSourceNode | null;
  chunkTimer: NodeJS.Timeout | null;
  pendingAudioChunks: Float32Array[];
  sendAudioChunk: ((isFinal: boolean) => Promise<void>) | null;
}

export const useAudioCapture = ({
  onAudioChunk,
  chunkDurationMs = 28000,
  enabled,
}: UseAudioCaptureParams): UseAudioCaptureOutput => {
  const [voiceDetected, setVoiceDetected] = useState(false);
  const stateRef = useRef<AudioCaptureState>({
    stream: null,
    vad: null,
    audioContext: null,
    audioWorkletNode: null,
    source: null,
    chunkTimer: null,
    pendingAudioChunks: [],
    sendAudioChunk: null,
  });

  // Main effect to handle enabled state changes
  useEffect(() => {
    let isCancelled = false;

    const cleanup = async () => {
      const state = stateRef.current;

      // Send final chunk if we have pending audio
      if (state.sendAudioChunk) {
        try {
          await state.sendAudioChunk(true);
        } catch (error) {
          console.error("AudioCapture: Error sending final chunk:", error);
        }
      }

      // Clear chunk timer
      if (state.chunkTimer) {
        clearInterval(state.chunkTimer);
        state.chunkTimer = null;
      }

      // Cleanup AudioWorklet
      if (state.audioWorkletNode) {
        state.audioWorkletNode.port.postMessage({ command: "stop" });
        state.audioWorkletNode.disconnect();
        state.audioWorkletNode = null;
      }

      if (state.source) {
        state.source.disconnect();
        state.source = null;
      }

      if (state.audioContext && state.audioContext.state !== "closed") {
        await state.audioContext.close();
        state.audioContext = null;
      }

      // Cleanup VAD
      if (state.vad) {
        try {
          state.vad.destroy();
          console.log("AudioCapture: VAD destroyed");
        } catch (e) {
          console.error("Error destroying VAD:", e);
        }
        state.vad = null;
      }

      // Stop media stream
      if (state.stream) {
        state.stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.error("Error stopping stream track:", e);
          }
        });
        state.stream = null;
      }

      // Reset state
      state.pendingAudioChunks = [];
      state.sendAudioChunk = null;
      setVoiceDetected(false);

      console.log("AudioCapture: Cleaned up");
    };

    const startCapture = async () => {
      console.log("AudioCapture: Starting capture...");

      try {
        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stateRef.current.stream = stream;

        // Set up Web Audio API with AudioWorklet for raw PCM data
        const audioContext = new AudioContext({ sampleRate: 16000 });
        stateRef.current.audioContext = audioContext;

        // Load AudioWorklet module using blob URL
        const blob = new Blob([audioRecorderWorkletSource], {
          type: "application/javascript",
        });
        const audioWorkletUrl = URL.createObjectURL(blob);

        try {
          await audioContext.audioWorklet.addModule(audioWorkletUrl);
        } finally {
          URL.revokeObjectURL(audioWorkletUrl);
        }

        if (isCancelled) {
          await cleanup();
          return;
        }

        const source = audioContext.createMediaStreamSource(stream);
        stateRef.current.source = source;

        // Create AudioWorklet node
        const audioWorkletNode = new AudioWorkletNode(
          audioContext,
          "audio-recorder-processor",
        );
        stateRef.current.audioWorkletNode = audioWorkletNode;

        // Create function to send accumulated chunks
        const sendAudioChunk = async (isFinal = false) => {
          const pendingChunks = stateRef.current.pendingAudioChunks;
          if (pendingChunks.length > 0) {
            // Combine all pending chunks into one array
            const totalLength = pendingChunks.reduce(
              (sum, chunk) => sum + chunk.length,
              0,
            );
            const combinedChunk = new Float32Array(totalLength);
            let offset = 0;

            for (const chunk of pendingChunks) {
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

            stateRef.current.pendingAudioChunks = []; // Clear chunks after sending
          }
        };

        stateRef.current.sendAudioChunk = sendAudioChunk;

        // Handle messages from AudioWorklet
        audioWorkletNode.port.onmessage = (event) => {
          if (event.data.type === "audioData") {
            const audioData = event.data.audioData as Float32Array;
            const isFinal = event.data.isFinal as boolean;

            // Store the audio chunk
            stateRef.current.pendingAudioChunks.push(audioData);

            if (isFinal) {
              // Send final chunk immediately
              sendAudioChunk(true);
            }
          }
        };

        // Set up periodic chunk sending
        const chunkTimer = setInterval(() => {
          sendAudioChunk(false);
        }, chunkDurationMs);
        stateRef.current.chunkTimer = chunkTimer;

        // Connect the audio processing chain
        source.connect(audioWorkletNode);
        console.log("AudioCapture: Connected AudioWorklet processing chain");

        // Set up VAD
        const vad = await MicVAD.new({
          stream,
          model: "v5",
          onSpeechStart: () => {
            // Check if component is still mounted before updating state
            if (!isCancelled) {
              console.log("VAD: Speech started");
              setVoiceDetected(true);
            }
          },
          onSpeechEnd: () => {
            console.log("VAD: Speech ended");
            // Check if component is still mounted before updating state
            if (!isCancelled) {
              console.log("VAD: Speech ended");
              setVoiceDetected(false);
            }
          },
        });

        // Store VAD reference immediately to ensure proper cleanup
        stateRef.current.vad = vad;

        if (isCancelled) {
          await cleanup();
          return;
        }

        vad.start();
        console.log("AudioCapture: VAD started");

        console.log("AudioCapture: Fully started");
      } catch (err) {
        console.error("AudioCapture: Error starting:", err);
        await cleanup();
        throw err;
      }
    };

    // Handle enabled state
    if (enabled) {
      startCapture().catch((err) => {
        console.error("AudioCapture: Failed to start:", err);
      });
    }

    // Cleanup function
    return () => {
      isCancelled = true;
      cleanup().catch((err) => {
        console.error("AudioCapture: Cleanup error:", err);
      });
    };
  }, [enabled, onAudioChunk, chunkDurationMs]);

  return {
    voiceDetected,
  };
};
