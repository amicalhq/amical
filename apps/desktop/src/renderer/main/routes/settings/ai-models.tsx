import { createFileRoute } from "@tanstack/react-router";
import AIModelsSettingsPage from "../../pages/settings/ai-models";

export const Route = createFileRoute("/settings/ai-models")({
  component: AIModelsSettingsPage,
});
