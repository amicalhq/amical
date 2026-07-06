import React, { useState, useRef, useEffect } from "react";
import { NotebookPen, Check, X, Pencil } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import type { RecordingStatus } from "@/hooks/useRecording";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { api } from "@/trpc/react";
import { NOTE_WINDOW_FEATURE_FLAG } from "@/utils/feature-flags";
import { setPassThroughReason } from "../../../pass-through";
import { useTranslation } from "react-i18next";

const NUM_WAVEFORM_BARS = 6; // Fewer bars to make room for stop button
const DEBOUNCE_DELAY = 100; // milliseconds

// Stop = commit: finish + transcribe + paste
const StopButton: React.FC<{ onClick: (e: React.MouseEvent) => void }> = ({
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-widget-control transition-colors hover:bg-widget-control/90"
    aria-label="Stop recording and transcribe"
  >
    <Check
      className="w-[13px] h-[13px] text-widget-control-foreground"
      strokeWidth={3.5}
    />
  </button>
);

// Dismiss = discard: abort + save audio to history, no paste
const DismissButton: React.FC<{ onClick: (e: React.MouseEvent) => void }> = ({
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-widget-control-muted transition-colors hover:bg-widget-control-muted/80"
    aria-label="Dismiss recording"
  >
    <X
      className="w-[13px] h-[13px] text-widget-control-muted-foreground"
      strokeWidth={3.5}
    />
  </button>
);

// Indigo pencil marking a draft (instruct) session in the FAB (dictating + processing).
// mr-2 adds gap between the glyph and the waveform/dots that follow it.
const DraftPen: React.FC = () => (
  <Pencil
    className="w-[13px] h-[13px] text-brand shrink-0 mr-2"
    strokeWidth={2}
  />
);

// Separate component for the processing indicator. Draft (instruct) sessions add
// an indigo pen glyph so "drafting…" reads differently from normal dictation;
// the dots stay blue in both cases.
const ProcessingIndicator: React.FC<{ isDraft?: boolean }> = ({ isDraft }) => (
  <div className="flex gap-1.5 items-center justify-center flex-1 h-6">
    {isDraft && <DraftPen />}
    <div className="flex gap-[4px] items-center">
      <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
      <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
      <div className="w-[4px] h-[4px] bg-blue-500 rounded-full animate-bounce" />
    </div>
  </div>
);

// Separate component for the waveform visualization
const WaveformVisualization: React.FC<{
  isRecording: boolean;
  audioLevels: number[];
}> = ({ isRecording, audioLevels }) => (
  <>
    {Array.from({ length: NUM_WAVEFORM_BARS }).map((_, index) => (
      <Waveform
        key={index}
        isRecording={isRecording}
        level={audioLevels[index] ?? 0}
        baseHeight={70}
        silentHeight={20}
      />
    ))}
  </>
);

interface FloatingButtonProps {
  recordingStatus: RecordingStatus;
  audioLevels: number[];
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  dismissRecording: () => Promise<void>;
}

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  recordingStatus,
  audioLevels,
  startRecording,
  stopRecording,
  dismissRecording,
}) => {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for debounce timeout
  const clickTimeRef = useRef<number | null>(null); // Track when user clicked

  const openNotesWindow = api.widget.openNotesWindow.useMutation();
  const noteWindowFeatureFlag = useFeatureFlag(NOTE_WINDOW_FEATURE_FLAG);

  // Release the hover pass-through reason if the FAB unmounts mid-hover (e.g.
  // a draft review takes over the widget), so it can't pin the window
  // clickable after the FAB is gone.
  useEffect(() => {
    return () => {
      setPassThroughReason("hover", false);
    };
  }, []);

  // STARTING is a brief handshake before renderer capture begins; keep the
  // widget expanded and waveform-shaped like the pre-FSM flow.
  const isRecording =
    recordingStatus.state === "recording" ||
    recordingStatus.state === "starting";
  const isStopping = recordingStatus.state === "stopping";
  const isHandsFreeMode = recordingStatus.mode === "hands-free";
  const isNoteWindowEnabled = noteWindowFeatureFlag.enabled;
  // Draft (instruct) session: show a distinct indicator while dictating + processing.
  const isDraft = recordingStatus.isDraft;

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

  // Handler for dismiss button in hands-free mode
  const handleDismissClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("FAB: Dismissing recording");
    await dismissRecording();
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
  const handleMouseLeave = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      // Drop only the hover reason; the controller keeps the widget clickable
      // if a toast or draft review still needs it.
      setPassThroughReason("hover", false);
    }, DEBOUNCE_DELAY);
  };

  // Mouse enter handler - clears any pending leave timeout
  const handleMouseEnter = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
    // Make the widget clickable while hovered.
    setPassThroughReason("hover", true);
  };

  const isWidgetActive = isRecording || isStopping || isHovered;
  const showNotesAction =
    isNoteWindowEnabled && isHovered && !isRecording && !isStopping;
  const sizeClass = !isWidgetActive
    ? "h-[8px] w-[48px]"
    : showNotesAction
      ? "h-[24px] w-[124px]"
      : isHandsFreeMode && isRecording
        ? "h-[24px] w-[100px]"
        : isDraft
          ? "h-[24px] w-[116px]"
          : "h-[24px] w-[96px]";

  // Function to render widget content based on state
  const renderWidgetContent = () => {
    if (!isWidgetActive) return null;

    // Show processing indicator when stopping.
    if (isStopping) {
      return <ProcessingIndicator isDraft={isDraft} />;
    }

    // Show dismiss (✗) | waveform | stop (✓) when hands-free and recording
    if (isHandsFreeMode && isRecording) {
      return (
        <>
          <div className="h-full items-center flex ml-[5px]">
            <DismissButton onClick={handleDismissClick} />
          </div>
          <div className="justify-center items-center flex flex-1 gap-1 min-w-0">
            <WaveformVisualization
              isRecording={isRecording}
              audioLevels={audioLevels}
            />
          </div>
          <div className="h-full items-center flex mr-[5px]">
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
          {isDraft && <DraftPen />}
          <WaveformVisualization
            isRecording={isRecording}
            audioLevels={audioLevels}
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
