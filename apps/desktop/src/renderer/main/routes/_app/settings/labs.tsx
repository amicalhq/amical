import { createFileRoute } from "@tanstack/react-router";

import LabsSettingsPage from "../../../pages/settings/labs";

export const Route = createFileRoute("/_app/settings/labs")({
  component: LabsSettingsPage,
});
