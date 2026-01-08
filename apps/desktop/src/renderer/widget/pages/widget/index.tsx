import { FloatingButton } from "./components/FloatingButton";
import { useWidgetNotifications } from "../../hooks/useWidgetNotifications";

export function WidgetPage() {
  useWidgetNotifications();
  return <FloatingButton />;
}
