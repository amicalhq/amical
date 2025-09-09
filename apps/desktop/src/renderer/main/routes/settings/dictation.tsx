import { createFileRoute } from "@tanstack/react-router";
import DictationSettingsPage from "../../pages/settings/dictation";

export const Route = createFileRoute("/settings/dictation")({
  component: DictationSettingsPage,
});
