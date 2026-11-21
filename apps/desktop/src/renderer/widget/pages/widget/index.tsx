import { FloatingButton } from "./components/FloatingButton";
import { DraftReview } from "./components/DraftReview";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";
import { useRecordingSettingsSync } from "../../hooks/useRecordingSettingsSync";
import { useHealPendingMicrophone } from "../../hooks/useHealPendingMicrophone";
import { useDraftReview } from "../../hooks/useDraftReview";
import { useWidgetVisibility } from "../../hooks/useWidgetVisibility";
import { useWidgetFeed } from "../../hooks/useWidgetFeed";
import { WidgetFeedCard } from "../../components/WidgetFeedCard";
import { useRecording } from "@/hooks/useRecording";

export function WidgetPage() {
  // Hosted at the widget root (always mounted) so the mic keeps capturing
  // whichever surface is shown — the FAB OR the draft review window. This is
  // what lets you re-dictate while a draft preview is open without losing audio.
  const recording = useRecording();
  const draft = useDraftReview();

  // Pass the live recording state so a new press clears any stale notification
  // toast from the previous session before it can bleed into this recording.
  const { hasVisibleNotification, notificationSequence } =
    useWidgetNotifications(recording.recordingStatus.state);
  const feed = useWidgetFeed({
    recordingState: recording.recordingStatus.state,
    hasVisibleToast: hasVisibleNotification,
    hasPendingDraft: draft.review !== null,
  });
  useWidgetVisibility({
    recordingState: recording.recordingStatus.state,
    hasPendingDraft: draft.review !== null,
    hasVisibleNotification: hasVisibleNotification || feed.card !== null,
    notificationSequence: notificationSequence + feed.showSequence,
  });
  useRecordingSettingsSync();
  useHealPendingMicrophone();

  if (draft.review) {
    return (
      <DraftReview
        text={draft.review.text}
        onInsert={draft.insert}
        onDismiss={draft.dismiss}
        onCopy={draft.copy}
        recordingStatus={recording.recordingStatus}
        audioLevelRef={recording.audioLevelRef}
      />
    );
  }

  return (
    <>
      {feed.card && (
        // Above the FAB, in the space the toasts use. The slot spans the window
        // above that, less room for the card's shadow, so a tall card scrolls.
        <div className="pointer-events-none fixed inset-x-0 top-3 bottom-10 flex items-end justify-center">
          <WidgetFeedCard key={feed.card.item.id} {...feed.card} />
        </div>
      )}
      <FloatingButton
        recordingStatus={recording.recordingStatus}
        audioLevelRef={recording.audioLevelRef}
        startRecording={recording.startRecording}
        stopRecording={recording.stopRecording}
        dismissRecording={recording.dismissRecording}
      />
    </>
  );
}
