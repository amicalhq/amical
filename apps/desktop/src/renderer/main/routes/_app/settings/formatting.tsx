import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/formatting")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/dictation",
    });
  },
});
