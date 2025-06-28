import { useState, useEffect, useRef, useCallback } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { Mutex } from "async-mutex";

export interface UseRecordingParams {
  onAudioChunk: (
    arrayBuffer: ArrayBuffer,
    isFinalChunk: boolean,
  ) => Promise<void> | void;
  chunkDurationMs?: number;
  onRecordingStartCallback?: () => Promise<void> | void;
  onRecordingStopCallback?: () => Promise<void> | void;
}

export type RecordingStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export interface UseRecordingOutput {
  recordingStatus: RecordingStatus; // For detailed state
  voiceDetected: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
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

export const useRecording = ({
  onAudioChunk,
  chunkDurationMs = 28000,
  onRecordingStartCallback,
  onRecordingStopCallback,
}: UseRecordingParams): UseRecordingOutput => {
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>("idle");
  const [voiceDetected, setVoiceDetected] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<MicVAD | null>(null);

  // Use a single mutex for all start/stop operations
  const operationMutexRef = useRef(new Mutex());

  const internalStopRecording = useCallback(
    async (callStopCallback: boolean) => {
      // This function assumes mutex is already acquired or not needed (e.g. unmount)
      console.log(
        "Hook: Internal: Stopping recording and sending final chunk...",
      );

      // Send final audio chunk before cleanup
      try {
        // Access the sendAudioChunk function from the current recording session
        // We need to store this reference when starting recording
        const sendFinalChunk = (window as any).currentSendAudioChunk;
        if (sendFinalChunk) {
          await sendFinalChunk(true); // Send final chunk
          console.log("Hook: Final audio chunk sent.");
        }
      } catch (error) {
        console.error("Hook: Error sending final audio chunk:", error);
      }

      // Cleanup all resources
      cleanupMediaResources(vadRef.current, streamRef.current);

      // Clear Web Audio API resources
      const cleanup = (window as any).currentWebAudioCleanup;
      if (cleanup) {
        cleanup();
        (window as any).currentWebAudioCleanup = null;
        (window as any).currentSendAudioChunk = null;
      }

      vadRef.current = null;
      streamRef.current = null;

      setRecordingStatus("idle");
      setVoiceDetected(false);

      if (callStopCallback && onRecordingStopCallback) {
        try {
          await onRecordingStopCallback();
          console.log("Hook: onRecordingStopCallback executed.");
        } catch (e) {
          console.error("Hook: Error in onRecordingStopCallback:", e);
        }
      }
    },
    [onRecordingStopCallback],
  );

  const startRecording = useCallback(async () => {
    await operationMutexRef.current.runExclusive(async () => {
      // Check status instead of just isRecording for more accurate state
      if (recordingStatus !== "idle" && recordingStatus !== "error") {
        console.log(`Hook: Start denied. Current status: ${recordingStatus}`);
        return;
      }

      setRecordingStatus("starting");
      console.log("Hook: Attempting to start recording (status: starting)...");

      let localStream: MediaStream | null = null;
      let localVad: MicVAD | null = null;

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        if (onRecordingStartCallback) {
          await onRecordingStartCallback();
          console.log("Hook: onRecordingStartCallback executed.");
        }

        streamRef.current = localStream; // Assign to ref after callback

        // Use Web Audio API with AudioWorklet for raw PCM data
        const audioContext = new AudioContext({ sampleRate: 16000 });

        let audioWorkletNode: AudioWorkletNode | null = null;
        let source: MediaStreamAudioSourceNode | null = null;
        let chunkTimer: NodeJS.Timeout | null = null;
        let pendingAudioChunks: Float32Array[] = [];

        // Load AudioWorklet module
        await audioContext.audioWorklet.addModule("/audio-recorder-worklet.js");
        console.log("Hook: AudioWorklet module loaded successfully");

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
                `Hook: Sent audio chunk: ${combinedChunk.length} samples, final: ${isFinal}`,
              );
            } catch (error) {
              console.error("Hook: Error processing audio chunk:", error);
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
        console.log("Hook: Connected AudioWorklet processing chain");

        // Store cleanup functions for Web Audio API
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
          console.log("Hook: Cleaned up AudioWorklet resources");
        };

        // Store references for cleanup and final chunk sending
        (window as any).currentWebAudioCleanup = cleanup;
        (window as any).currentSendAudioChunk = sendAudioChunk;

        console.log(
          `Hook: AudioWorklet recording started, chunk duration ${chunkDurationMs}ms.`,
        );

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
        console.log("Hook: VAD started (status: starting).");

        setRecordingStatus("recording");
        console.log("Hook: Recording fully started (status: recording).");
      } catch (err) {
        console.error("Hook: Error starting recording:", err);
        cleanupMediaResources(localVad, localStream);
        streamRef.current = null; // Ensure refs are cleared on error
        vadRef.current = null;

        setRecordingStatus("error");
        setVoiceDetected(false);
        if (onRecordingStopCallback) {
          // If start callback was called, call stop callback
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
    });
  }, [
    onAudioChunk,
    chunkDurationMs,
    onRecordingStartCallback,
    onRecordingStopCallback,
    recordingStatus,
  ]);

  const stopRecording = useCallback(async () => {
    await operationMutexRef.current.runExclusive(async () => {
      // Check status for more accurate state
      if (recordingStatus !== "recording" && recordingStatus !== "starting") {
        console.log(`Hook: Stop called but status is ${recordingStatus}.`);
        // If it's 'stopping', we are already on it. If 'idle' or 'error', nothing to stop.
        return;
      }

      console.log("Hook: Attempting to stop recording (status: stopping)...");
      setRecordingStatus("stopping");
      // internalStopRecording will handle the rest, including setting isAwaitingFinalChunk
      await internalStopRecording(true); // true to callStopCallback if applicable
    });
  }, [internalStopRecording, recordingStatus]);

  useEffect(() => {
    // Capture refs and callbacks needed for cleanup at the time the effect is established.
    const capturedStreamRef = streamRef;
    const capturedVadRef = vadRef;

    // We need to know if recording was active *at the time of unmount setup*
    // to decide if onRecordingStopCallback should be called.
    // However, state variables are not stable in the cleanup function's closure
    // if the dependency array is empty.
    // The most robust way is to rely on the refs or call a "stop" function that handles it.

    // Let's simplify: the primary goal of unmount is to release browser resources.
    // The mutex-protected stopRecording should handle application-level state and callbacks.
    // If the component unmounts abruptly, we prioritize resource release.

    return () => {
      console.log("Hook: Unmounting...");

      // Directly clean up resources using captured refs.
      // This avoids issues with stale state in async mutex operations during unmount.
      const str = capturedStreamRef.current;
      const vad = capturedVadRef.current;

      // Clean up VAD and Stream.
      cleanupMediaResources(vad, str);

      // Clean up Web Audio API resources
      const cleanup = (window as any).currentWebAudioCleanup;
      if (cleanup) {
        cleanup();
        (window as any).currentWebAudioCleanup = null;
        (window as any).currentSendAudioChunk = null;
      }

      // Nullify refs after cleanup
      capturedStreamRef.current = null;
      capturedVadRef.current = null;

      // Note: Calling setIsRecording(false) etc. here has no effect as the component is unmounted.
      // onRecordingStopCallback might not be reliably called here if stop() was async and didn't complete.
      // The expectation is that the user of the hook calls stopRecording and awaits it before unmounting
      // if graceful shutdown with all callbacks is critical.
      // This unmount is a "best effort" to release browser resources.
      console.log("Hook: Unmount cleanup finished.");
    };
  }, []); // EMPTY DEPENDENCY ARRAY FOR UNMOUNT CLEANUP

  console.log(
    "Hook: Render. status:",
    recordingStatus,
    "voice:",
    voiceDetected,
  );
  return {
    recordingStatus,
    voiceDetected,
    startRecording,
    stopRecording,
  };
};
