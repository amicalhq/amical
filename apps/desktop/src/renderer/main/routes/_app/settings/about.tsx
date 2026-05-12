import { createFileRoute } from "@tanstack/react-router";
import AboutSettingsPage from "../../../pages/settings/about";

export const Route = createFileRoute("/_app/settings/about")({
  component: AboutSettingsPage,
});
