import { useMemo } from "react";
import { NotesWindowPanel } from "../../components/NotesWindowPanel";

export function NotesWidgetPage() {
  const bootstrapOpenParams = useMemo(() => {
    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(rawHash);

    let initialNoteId: number | undefined = undefined;
    let shouldCreateInitialNote = false;

    if (hashParams.has("noteId")) {
      const rawNoteId = hashParams.get("noteId");
      if (rawNoteId && rawNoteId.trim().length > 0) {
        const parsedNoteId = Number.parseInt(rawNoteId, 10);
        if (Number.isFinite(parsedNoteId) && parsedNoteId > 0) {
          initialNoteId = parsedNoteId;
        } else {
          shouldCreateInitialNote = true;
        }
      } else {
        shouldCreateInitialNote = true;
      }
    }

    if (rawHash.length > 0) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }

    return { initialNoteId, shouldCreateInitialNote };
  }, []);

  return (
    <NotesWindowPanel
      initialNoteId={bootstrapOpenParams.initialNoteId}
      shouldCreateInitialNote={bootstrapOpenParams.shouldCreateInitialNote}
    />
  );
}
