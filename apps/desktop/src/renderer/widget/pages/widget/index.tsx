import { FloatingButton } from "./components/FloatingButton";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";
import { useRecordingSettingsSync } from "../../hooks/useRecordingSettingsSync";

export function WidgetPage() {
  useWidgetNotifications();
  useRecordingSettingsSync();
  return <FloatingButton />;
}
