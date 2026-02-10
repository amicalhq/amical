import { createFileRoute } from "@tanstack/react-router";
import ModesPage from "../../pages/settings/modes";

export const Route = createFileRoute("/settings/modes")({
  component: ModesPage,
});
