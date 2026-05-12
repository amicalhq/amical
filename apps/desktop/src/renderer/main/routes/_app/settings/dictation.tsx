import { createFileRoute } from "@tanstack/react-router";
import DictationSettingsPage from "../../../pages/settings/dictation";

export const Route = createFileRoute("/_app/settings/dictation")({
  component: DictationSettingsPage,
});
