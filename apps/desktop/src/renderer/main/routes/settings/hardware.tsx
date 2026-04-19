import { createFileRoute } from "@tanstack/react-router";
import HardwareSettingsPage from "../../pages/settings/hardware";

export const Route = createFileRoute("/settings/hardware")({
  component: HardwareSettingsPage,
});
