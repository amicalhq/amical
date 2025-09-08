import { createFileRoute } from "@tanstack/react-router";
import AdvancedSettingsPage from "../../pages/settings/advanced";

export const Route = createFileRoute("/settings/advanced")({
  component: AdvancedSettingsPage,
});
