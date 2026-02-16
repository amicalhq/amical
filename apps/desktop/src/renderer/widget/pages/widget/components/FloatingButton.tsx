import React, { useState, useRef, useEffect } from "react";
import { NotebookPen, Square } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import { useRecording } from "@/hooks/useRecording";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { api } from "@/trpc/react";
import { NOTE_WINDOW_FEATURE_FLAG } from "@/utils/feature-flags";
import { useTranslation } from "react-i18next";

const NUM_WAVEFORM_BARS = 6; // Fewer bars to make room for stop button
const DEBOUNCE_DELAY = 100; // milliseconds

// Separate component for the stop button
const StopButton: React.FC<{ onClick: (e: React.MouseEvent) => void }> = ({
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center w-[20px] h-[20px]rounded transition-colors"
    aria-label="Stop recording"
  >
    <Square className="w-[12px] h-[12px] text-red-500 fill-red-500" />
  </button>
);

// Separate component for the processing indicator
const ProcessingIndicator: React.FC = () => (
  <div className="flex gap-[4px] items-center justify-center flex-1 h-6">
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
        baseHeight={60}
        silentHeight={20}
      />
    ))}
  </>
);

export const FloatingButton: React.FC = () => {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for debounce timeout
  const clickTimeRef = useRef<number | null>(null); // Track when user clicked

  // tRPC mutation to control widget mouse events
  const setIgnoreMouseEvents = api.widget.setIgnoreMouseEvents.useMutation();
  const openNotesWindow = api.widget.openNotesWindow.useMutation();
  const noteWindowFeatureFlag = useFeatureFlag(NOTE_WINDOW_FEATURE_FLAG);

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
  const isNoteWindowEnabled = noteWindowFeatureFlag.enabled;

  // Track when recording state changes to "recording" after a click
  useEffect(() => {
    if (recordingStatus.state === "recording" && clickTimeRef.current) {
      const timeSinceClick = performance.now() - clickTimeRef.current;
      console.log(
        `FAB: Recording state became 'recording' ${timeSinceClick.toFixed(2)}ms after user click`,
      );
      clickTimeRef.current = null; // Reset
    }
  }, [recordingStatus.state]);

  // Handler for widget click to start recording in hands-free mode
  const handleButtonClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clickTime = performance.now();
    clickTimeRef.current = clickTime;
    console.log("FAB: Button clicked at", clickTime);
    console.log("FAB: Current status:", recordingStatus);

    // Only start recording if not already recording
    if (recordingStatus.state === "idle") {
      const startRecordingCallTime = performance.now();
      await startRecording();
      const startRecordingReturnTime = performance.now();
      console.log(
        `FAB: startRecording() call took ${(startRecordingReturnTime - startRecordingCallTime).toFixed(2)}ms to return`,
      );
      console.log("FAB: Started hands-free recording");
    } else {
      console.log("FAB: Already recording, ignoring click");
      clickTimeRef.current = null; // Reset since we're not starting
    }
  };

  // Handler for stop button in hands-free mode
  const handleStopClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent triggering the main button click
    console.log("FAB: Stopping hands-free recording");
    await stopRecording();
  };

  const handleOpenNotesClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isNoteWindowEnabled) {
      return;
    }
    try {
      await openNotesWindow.mutateAsync();
    } catch (error) {
      console.error("Failed to open notes window widget", error);
    }
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

  const isWidgetActive = isRecording || isStopping || isHovered;
  const showNotesAction =
    isNoteWindowEnabled && isHovered && !isRecording && !isStopping;
  const sizeClass = !isWidgetActive
    ? "h-[8px] w-[48px]"
    : showNotesAction
      ? "h-[24px] w-[124px]"
      : "h-[24px] w-[96px]";

  // Function to render widget content based on state
  const renderWidgetContent = () => {
    if (!isWidgetActive) return null;

    // Show processing indicator when stopping
    if (isStopping) {
      return <ProcessingIndicator />;
    }

    // Show waveform with stop button when in hands-free mode and recording
    if (isHandsFreeMode && isRecording) {
      return (
        <>
          <div className="justify-center items-center flex flex-1 gap-1">
            <WaveformVisualization
              isRecording={isRecording}
              voiceDetected={voiceDetected}
            />
          </div>
          <div className="h-full items-center flex mr-2">
            <StopButton onClick={handleStopClick} />
          </div>
        </>
      );
    }

    // Show waveform visualization for all other states
    return (
      <>
        <button
          className="justify-center items-center flex flex-1 gap-1 h-full"
          role="button"
          onClick={handleButtonClick}
        >
          <WaveformVisualization
            isRecording={isRecording}
            voiceDetected={voiceDetected}
          />
        </button>

        {showNotesAction && (
          <button
            className="h-full px-2 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            onClick={handleOpenNotesClick}
            aria-label={t("settings.notes.note.actions.openInNotesWindow")}
            title={t("settings.notes.note.actions.openInNotesWindow")}
          >
            <NotebookPen className="w-[14px] h-[14px]" />
          </button>
        )}
      </>
    );
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        transition-all duration-200 ease-in-out
        ${sizeClass}
        bg-black/70 rounded-[24px] backdrop-blur-md ring-[1px] ring-black/60 shadow-[0px_0px_15px_0px_rgba(0,0,0,0.40)]
        before:content-[''] before:absolute before:inset-[1px] before:rounded-[23px] before:outline before:outline-white/15 before:pointer-events-none
        mb-2 cursor-pointer select-none
      `}
      style={{ pointerEvents: "auto" }}
    >
      {isWidgetActive && (
        <div className="flex gap-[2px] h-full w-full justify-between">
          {renderWidgetContent()}
        </div>
      )}
    </div>
  );
};
