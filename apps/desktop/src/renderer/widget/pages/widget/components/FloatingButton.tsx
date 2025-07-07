import React, { useState, useRef, useEffect } from "react";
import { Square } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import { useRecording } from "@/hooks/useRecording";
import { api } from "@/trpc/react";

const NUM_WAVEFORM_BARS = 6; // Fewer bars to make room for stop button
const DEBOUNCE_DELAY = 100; // milliseconds

// Separate component for the stop button
const StopButton: React.FC<{ onClick: (e: React.MouseEvent) => void }> = ({
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center w-[20px] h-[20px] bg-red-500 hover:bg-red-600 rounded transition-colors"
    aria-label="Stop recording"
  >
    <Square className="w-[12px] h-[12px] text-white fill-white" />
  </button>
);

// Separate component for the processing indicator
const ProcessingIndicator: React.FC = () => (
  <div className="flex gap-[4px] items-center justify-center">
    <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
    <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
    <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce" />
  </div>
);

// Separate component for the waveform visualization
const WaveformVisualization: React.FC<{
  isRecording: boolean;
  voiceDetected: boolean;
}> = ({ isRecording, voiceDetected }) => (
  <>
    {Array.from({ length: NUM_WAVEFORM_BARS }).map((_, index) => (
      <Waveform
        key={index}
        index={index}
        isRecording={isRecording}
        voiceDetected={voiceDetected}
        baseHeight={100}
        silentHeight={20}
      />
    ))}
  </>
);

export const FloatingButton: React.FC = () => {
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for debounce timeout

  // tRPC mutation to control widget mouse events
  const setIgnoreMouseEvents = api.widget.setIgnoreMouseEvents.useMutation();

  // Log component initialization
  useEffect(() => {
    console.log("FloatingButton component initialized");
    return () => {
      console.debug("FloatingButton component unmounting");
    };
  }, []);

  const { recordingStatus, stopRecording, voiceDetected, startRecording } =
    useRecording();
  const isRecording =
    recordingStatus.state === "recording" ||
    recordingStatus.state === "starting";
  const isStopping = recordingStatus.state === "stopping";
  const isHandsFreeMode = recordingStatus.mode === "hands-free";

  // Handler for widget click to start recording in hands-free mode
  const handleButtonClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("FAB: Button clicked! Current status:", recordingStatus);

    // Only start recording if not already recording
    if (recordingStatus.state === "idle") {
      await startRecording();
      console.log("FAB: Started hands-free recording");
    } else {
      console.log("FAB: Already recording, ignoring click");
    }
  };

  // Handler for stop button in hands-free mode
  const handleStopClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent triggering the main button click
    console.log("FAB: Stopping hands-free recording");
    await stopRecording();
  };

  // Debounced mouse leave handler
  const handleMouseLeave = async () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(async () => {
      setIsHovered(false);
      // Re-enable mouse event forwarding when not hovering
      try {
        await setIgnoreMouseEvents.mutateAsync({ ignore: true });
        console.debug("Re-enabled mouse event forwarding");
      } catch (error) {
        console.error("Failed to re-enable mouse event forwarding:", error);
      }
    }, DEBOUNCE_DELAY);
  };

  // Mouse enter handler - clears any pending leave timeout
  const handleMouseEnter = async () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
    // Disable mouse event forwarding to make widget clickable
    await setIgnoreMouseEvents.mutateAsync({ ignore: false });
    console.debug("Disabled mouse event forwarding for clicking");
  };

  const expanded = isRecording || isStopping || isHovered;

  // Function to render widget content based on state
  const renderWidgetContent = () => {
    if (!expanded) return null;

    // Show processing indicator when stopping
    if (isStopping) {
      return <ProcessingIndicator />;
    }

    // Show waveform with stop button when in hands-free mode and recording
    if (isHandsFreeMode && isRecording) {
      return (
        <>
          <WaveformVisualization
            isRecording={isRecording}
            voiceDetected={voiceDetected}
          />
          <div className="ml-[4px]">
            <StopButton onClick={handleStopClick} />
          </div>
        </>
      );
    }

    // Show waveform visualization for all other states
    return (
      <WaveformVisualization
        isRecording={isRecording}
        voiceDetected={voiceDetected}
      />
    );
  };

  return (
    <button
      role="button"
      onClick={handleButtonClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        transition-all duration-200 ease-in-out
        ${expanded ? "h-[32px] w-[112px]" : "h-[16px] w-[48px]"}
        rounded-full border-2 border-text-muted bg-black/50 border-muted-foreground
        mb-2 cursor-pointer select-none
      `}
      style={{ pointerEvents: "auto" }}
    >
      {expanded && (
        <div className="flex gap-[2px] items-end h-[40%] justify-center w-full">
          {renderWidgetContent()}
        </div>
      )}
    </button>
  );
};
