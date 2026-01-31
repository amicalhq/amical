import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import NotePage from "../../pages/notes/components/note-wrapper";

const noteSearchSchema = z.object({
  autoRecord: z.preprocess((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "true";
    return undefined;
  }, z.boolean().optional()),
});

export const Route = createFileRoute("/settings/notes/$noteId")({
  component: NotePageWrapper,
  validateSearch: noteSearchSchema,
});

function NotePageWrapper() {
  const { noteId } = Route.useParams();
  const { autoRecord } = Route.useSearch();

  return <NotePage noteId={noteId} autoRecord={autoRecord} />;
}
