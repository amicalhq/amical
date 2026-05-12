import { createFileRoute } from "@tanstack/react-router";
import PreferencesPage from "../../../pages/settings/preferences";

export const Route = createFileRoute("/_app/settings/preferences")({
  component: PreferencesPage,
});
