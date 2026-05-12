import { createFileRoute } from "@tanstack/react-router";
import { ShortcutsSettingsPage } from "../../../pages/settings/shortcuts";

export const Route = createFileRoute("/_app/settings/shortcuts")({
  component: ShortcutsSettingsPage,
});
