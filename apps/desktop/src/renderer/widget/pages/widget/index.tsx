import { FloatingButton } from "./components/FloatingButton";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";
import { useRecordingSettingsSync } from "../../hooks/useRecordingSettingsSync";
import { useHealPendingMicrophone } from "../../hooks/useHealPendingMicrophone";

export function WidgetPage() {
  useWidgetNotifications();
  useRecordingSettingsSync();
  useHealPendingMicrophone();
  return <FloatingButton />;
}
