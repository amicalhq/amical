import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import AIModelsSettingsPage from "../../pages/settings/ai-models";

const aiModelsSearchSchema = z.object({
  tab: z.enum(["speech", "language", "embedding"]).optional().default("speech"),
});

export const Route = createFileRoute("/settings/ai-models")({
  validateSearch: aiModelsSearchSchema,
  component: AIModelsSettingsPage,
});
