import { useEffect, useState } from "react";
import { NotesWindowPanel } from "../../components/NotesWindowPanel";

export function NotesWidgetPage() {
  const [newNoteSignal, setNewNoteSignal] = useState(1);

  useEffect(() => {
    const handleNewNoteRequested = () => {
      setNewNoteSignal((previous) => previous + 1);
    };

    window.electronAPI.on(
      "notes-window:new-note-requested",
      handleNewNoteRequested,
    );
    return () => {
      window.electronAPI.off(
        "notes-window:new-note-requested",
        handleNewNoteRequested,
      );
    };
  }, []);

  return <NotesWindowPanel newNoteSignal={newNoteSignal} />;
}
