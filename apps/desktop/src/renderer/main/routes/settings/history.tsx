import { createFileRoute } from "@tanstack/react-router";
import HistorySettingsPage from "../../pages/settings/history";

export const Route = createFileRoute("/settings/history")({
  component: HistorySettingsPage,
});
