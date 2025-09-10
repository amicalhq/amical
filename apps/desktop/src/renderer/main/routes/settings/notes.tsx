import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/notes")({
  component: () => <Outlet />,
});
