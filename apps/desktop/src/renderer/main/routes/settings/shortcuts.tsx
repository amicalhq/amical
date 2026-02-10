import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/shortcuts")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/preferences",
    });
  },
});
