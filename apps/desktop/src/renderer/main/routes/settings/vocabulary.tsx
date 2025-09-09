import { createFileRoute } from "@tanstack/react-router";
import VocabularySettingsPage from "../../pages/settings/vocabulary";

export const Route = createFileRoute("/settings/vocabulary")({
  component: VocabularySettingsPage,
});
