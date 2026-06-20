import { FloatingButton } from "./components/FloatingButton";
import { DraftReview } from "./components/DraftReview";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";
import { useRecordingSettingsSync } from "../../hooks/useRecordingSettingsSync";
import { useHealPendingMicrophone } from "../../hooks/useHealPendingMicrophone";
import { useDraftReview } from "../../hooks/useDraftReview";

export function WidgetPage() {
  useWidgetNotifications();
  useRecordingSettingsSync();
  useHealPendingMicrophone();

  const draft = useDraftReview();

  if (draft.review) {
    return (
      <DraftReview
        text={draft.review.text}
        onInsert={draft.insert}
        onDismiss={draft.dismiss}
      />
    );
  }

  return <FloatingButton />;
}
