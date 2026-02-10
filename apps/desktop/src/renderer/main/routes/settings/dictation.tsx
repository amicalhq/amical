import { createFileRoute } from "@tanstack/react-router";
import DictationSettingsPage from "../../pages/settings/dictation";

// Legacy route: replaced by /settings/modes in the sidebar navigation.
// Kept for backwards compatibility (bookmarks, direct URL access).
export const Route = createFileRoute("/settings/dictation")({
  component: DictationSettingsPage,
});
