import { useState } from "react";
import { NotesHomePage } from "./components/notes-home-page";
import NotePage from "./components/note-page";

export function NotesPage() {
  const [selectedNotesId, setSelectedNotesId] = useState<string | null>(null);
  
  if (selectedNotesId) {
    return <NotePage noteId={selectedNotesId} onBack={()=>setSelectedNotesId(null)} />;
  }
  return <NotesHomePage onNoteClick={(noteId)=>setSelectedNotesId(noteId)} />;
}
