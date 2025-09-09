import { createFileRoute } from "@tanstack/react-router";
import { ShortcutsSettingsPage } from "../../pages/settings/shortcuts";

export const Route = createFileRoute("/settings/shortcuts")({
  component: ShortcutsSettingsPage,
});
