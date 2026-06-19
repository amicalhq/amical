import { FloatingButton } from "./components/FloatingButton";
import { InstructReview } from "./components/InstructReview";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";
import { useRecordingSettingsSync } from "../../hooks/useRecordingSettingsSync";
import { useHealPendingMicrophone } from "../../hooks/useHealPendingMicrophone";
import { useInstructReview } from "../../hooks/useInstructReview";

export function WidgetPage() {
  useWidgetNotifications();
  useRecordingSettingsSync();
  useHealPendingMicrophone();

  const instruct = useInstructReview();

  if (instruct.review) {
    return (
      <InstructReview
        text={instruct.review.text}
        onPaste={instruct.paste}
        onDismiss={instruct.dismiss}
      />
    );
  }

  return <FloatingButton />;
}
