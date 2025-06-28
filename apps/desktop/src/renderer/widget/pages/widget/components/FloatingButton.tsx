import React, { useState, useCallback, useRef, useEffect } from "react";
import { Waveform } from "@/components/Waveform";
import { useRecording, RecordingStatus } from "@/hooks/useRecording";

const NUM_WAVEFORM_BARS = 8; // Fewer bars for a smaller button
const DEBOUNCE_DELAY = 100; // milliseconds

export const FloatingButton: React.FC = () => {
  const [isHovered, setIsHovered] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for debounce timeout

  const handleAudioChunk = useCallback(
    async (audioChunk: ArrayBuffer, isFinalChunk: boolean) => {
      try {
        // Send the audio chunk regardless of whether it's final or not
        await window.electronAPI.sendAudioChunk(audioChunk, isFinalChunk);
        console.log(`FAB: Sent audio chunk. isFinalChunk: ${isFinalChunk}`);

        if (isFinalChunk) {
          console.log(
            "FAB: This was the final chunk. Informing main process to finalize transcription.",
          );
          // You might want to add a specific IPC call here if the main process needs an explicit signal
          // to finalize transcription, e.g., window.electronAPI.finalizeTranscription();
          // For now, we assume sendAudioChunk is enough and the main process handles the stream end.
        }
      } catch (error) {
        console.error("FAB: Error sending audio chunk:", error);
      }
    },
    [],
  );

  const { recordingStatus, startRecording, stopRecording, voiceDetected } =
    useRecording({
      onAudioChunk: handleAudioChunk,
      onRecordingStartCallback: async () =>
        await window.electronAPI.onRecordingStarting(),
      onRecordingStopCallback: async () =>
        await window.electronAPI.onRecordingStopping(),
      // Optionally, set chunkDurationMs here if needed, e.g., chunkDurationMs: 250
    });
  const isRecording =
    recordingStatus === "recording" || recordingStatus === "starting";
  const isAwaitingFinalChunk = recordingStatus === "stopping";
  console.log("FAB: recordingStatus:", recordingStatus);

  useEffect(() => {
    const cleanup = window.electronAPI.onRecordingStateChanged(
      (newState: boolean) => {
        console.log("FAB: Received new recording state:", newState);
        if (newState) {
          startRecording();
        } else {
          stopRecording();
        }
      },
    );
    return cleanup; // Cleanup the listener when the component unmounts
  }, [startRecording, stopRecording]);

  // This handler is for the button click.
  // It now uses the toggleRecording from the hook.
  const handleButtonClickToggleRecording = () => {
    console.log("FAB: Invoking toggleRecording from hook.");
    // The hook internally manages starting/stopping MediaRecorder and VAD.
    // The hook also listens for global state changes from the main process.
  };

  // Function to send the FAB's size to Electron
  const updateWindowSizeToFab = () => {
    if (isHovered || isRecording) {
      //window.electronAPI.resizeWindow(96, 32);
    } else {
      //window.electronAPI.resizeWindow(48, 16);
    }
  };

  // Update window size when recording or hover state changes
  useEffect(() => {
    console.log("is hovered", isHovered);
    updateWindowSizeToFab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, isHovered]);

  // Debounced mouse leave handler
  const handleMouseLeave = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, DEBOUNCE_DELAY);
  };

  // Mouse enter handler - clears any pending leave timeout
  const handleMouseEnter = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
      }
    };
  }, []);

  const expanded =
    recordingStatus === "recording" ||
    recordingStatus === "starting" ||
    recordingStatus === "stopping" ||
    isHovered;

  return (
    <button
      role="button"
      ref={fabRef}
      // onClick={handleButtonClickToggleRecording} // Removed onClick to disable manual toggle
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        transition-all duration-200 ease-in-out
        ${expanded ? "h-[32px] w-[96px]" : "h-[16px] w-[48px]"}
        rounded-full border-2 border-text-muted bg-black/10 border-muted-foreground
        mb-2
      `}
    >
      {expanded && (
        <div className="flex gap-[2px] items-end h-[40%] justify-center w-full">
          {Array.from({ length: NUM_WAVEFORM_BARS }).map((_, index) => (
            <Waveform
              key={index}
              index={index}
              isRecording={
                recordingStatus === "recording" ||
                recordingStatus === "starting"
              }
              voiceDetected={voiceDetected} // Use local state for VAD
              baseHeight={100} // Percentage of its container (the 40% height div)
              silentHeight={20} // Percentage
            />
          ))}
        </div>
      )}
    </button>
  );
};
