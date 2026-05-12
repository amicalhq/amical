import { createFileRoute } from "@tanstack/react-router";
import NotesPage from "../../pages/notes";

export const Route = createFileRoute("/_app/notes/")({
  component: NotesPage,
});
