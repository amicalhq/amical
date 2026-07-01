import { FloatingButton } from "./components/FloatingButton";
import { DraftReview } from "./components/DraftReview";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";
import { useRecordingSettingsSync } from "../../hooks/useRecordingSettingsSync";
import { useHealPendingMicrophone } from "../../hooks/useHealPendingMicrophone";
import { useDraftReview } from "../../hooks/useDraftReview";
import { useRecording } from "@/hooks/useRecording";

export function WidgetPage() {
  // Hosted at the widget root (always mounted) so the mic keeps capturing
  // whichever surface is shown — the FAB OR the draft review window. This is
  // what lets you re-dictate while a draft preview is open without losing audio.
  const recording = useRecording();
  const draft = useDraftReview();

  // Pass the live recording state so a new press clears any stale notification
  // toast from the previous session before it can bleed into this recording.
  useWidgetNotifications(recording.recordingStatus.state);
  useRecordingSettingsSync();
  useHealPendingMicrophone();

  if (draft.review) {
    return (
      <DraftReview
        text={draft.review.text}
        onInsert={draft.insert}
        onDismiss={draft.dismiss}
        recordingStatus={recording.recordingStatus}
        voiceDetected={recording.voiceDetected}
      />
    );
  }

  return (
    <FloatingButton
      recordingStatus={recording.recordingStatus}
      voiceDetected={recording.voiceDetected}
      startRecording={recording.startRecording}
      stopRecording={recording.stopRecording}
      dismissRecording={recording.dismissRecording}
    />
  );
}
