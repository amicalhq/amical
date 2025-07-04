import React, { useState, useCallback, useRef, useEffect } from "react";
import { Waveform } from "@/components/Waveform";
import { useRecording } from "@/hooks/useRecording";
import type { RecordingState } from "@/types/recording";

const NUM_WAVEFORM_BARS = 8; // Fewer bars for a smaller button
const DEBOUNCE_DELAY = 100; // milliseconds;

export const FloatingButton: React.FC = () => {
  const [isHovered, setIsHovered] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for debounce timeout

  // Log component initialization
  useEffect(() => {
    console.log("FloatingButton component initialized");
    return () => {
      console.debug("FloatingButton component unmounting");
    };
  }, []);

  const handleAudioFrame = useCallback(
    async (
      audioBuffer: ArrayBuffer,
      speechProbability: number,
      isFinal: boolean,
    ) => {
      try {
        // Send frame directly to main process
        // TODO: We need to update the IPC to include speech detection info
        await window.electronAPI.sendAudioChunk(audioBuffer, isFinal);
        console.debug(`Sent audio frame`, {
          size: audioBuffer.byteLength,
          speechProbability: speechProbability.toFixed(3),
          isFinal,
        });

        if (isFinal) {
          console.log("Final frame sent to main process");
        }
      } catch (error) {
        console.error("Error sending audio frame:", error);
      }
    },
    [],
  );

  const { recordingStatus, startRecording, stopRecording, voiceDetected } =
    useRecording({
      onAudioFrame: handleAudioFrame,
    });
  const isRecording =
    recordingStatus === "recording" || recordingStatus === "starting";
  const isAwaitingFinalChunk = recordingStatus === "stopping";

  // Log recording status changes
  useEffect(() => {
    console.debug("Recording status changed", { recordingStatus });
  }, [recordingStatus]);

  // Recording state is now managed centrally, no need for separate listener

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
    console.debug("Widget state changed", { isHovered, isRecording });
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
          {recordingStatus === "stopping" ? (
            // Show processing indicator when stopping
            <div className="flex gap-[4px] items-center justify-center">
              <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce"></div>
            </div>
          ) : (
            // Show waveform for other states
            Array.from({ length: NUM_WAVEFORM_BARS }).map((_, index) => (
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
            ))
          )}
        </div>
      )}
    </button>
  );
};
