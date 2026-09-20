import { createFileRoute } from "@tanstack/react-router";

import McpSettingsPage from "../../../pages/settings/mcp";

export const Route = createFileRoute("/_app/settings/mcp")({
  component: McpSettingsPage,
});
