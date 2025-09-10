import { createFileRoute } from "@tanstack/react-router";
import NotePage from "../../pages/notes/components/note-wrapper";

export const Route = createFileRoute("/settings/notes/$noteId")({
  component: NotePageWrapper,
});

function NotePageWrapper() {
  const { noteId } = Route.useParams();

  return <NotePage noteId={noteId} />;
}
