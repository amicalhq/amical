import { createFileRoute } from "@tanstack/react-router";
import PersonalizationSettingsPage from "../../../pages/settings/formatting";

export const Route = createFileRoute("/_app/settings/formatting")({
  component: PersonalizationSettingsPage,
});
