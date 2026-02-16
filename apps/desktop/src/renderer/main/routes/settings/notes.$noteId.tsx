import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import NotePage from "../../pages/notes/components/note-wrapper";
import { useSettingsHeaderActions } from "./header-actions-context";
import { NotesPopoutHeaderAction } from "./notes-popout-header-action";

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
  const { setActions } = useSettingsHeaderActions();
  const parsedNoteId = Number.parseInt(noteId, 10);

  useEffect(() => {
    if (!Number.isFinite(parsedNoteId)) {
      setActions(null);
      return;
    }

    setActions(<NotesPopoutHeaderAction noteId={parsedNoteId} />);
  }, [parsedNoteId, setActions]);

  useEffect(() => {
    return () => {
      setActions(null);
    };
  }, [setActions]);

  return <NotePage noteId={noteId} autoRecord={autoRecord} />;
}
