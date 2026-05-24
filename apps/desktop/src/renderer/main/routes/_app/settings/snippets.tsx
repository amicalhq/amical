import { createFileRoute } from "@tanstack/react-router";
import SnippetsSettingsPage from "../../../pages/settings/snippets";

export const Route = createFileRoute("/_app/settings/snippets")({
  component: SnippetsSettingsPage,
});
