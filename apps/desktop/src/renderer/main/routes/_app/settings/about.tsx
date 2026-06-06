import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import AboutSettingsPage from "../../../pages/settings/about";

export const Route = createFileRoute("/_app/settings/about")({
  component: AboutSettingsPage,
  validateSearch: z.object({
    // Set by the sidebar "Update Ready" CTA to scroll/highlight the update card.
    focusUpdate: z.boolean().optional(),
  }),
});
