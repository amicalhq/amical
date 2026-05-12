import { createFileRoute } from "@tanstack/react-router";
import AdvancedSettingsPage from "../../../pages/settings/advanced";

export const Route = createFileRoute("/_app/settings/advanced")({
  component: AdvancedSettingsPage,
});
