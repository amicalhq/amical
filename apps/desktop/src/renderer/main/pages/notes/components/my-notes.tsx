import { NotebookText, Plus } from "lucide-react";
import { NoteCard } from "./note-card";
import { Note } from "../types";
import { Button } from "@/components/ui/button";

type NotesState = "with-notes" | "no-notes";

type MyNotesProps = {
  onNoteClick: (noteId: string) => void;
};

export function MyNotes({ onNoteClick }: MyNotesProps) {
  // Switch this variable to test different states:
  // "with-notes" - shows notes list
  // "no-notes" - no notes, shows create note UI
  const notesState: NotesState = "with-notes";

  // Mock notes data
  const mockNotes: Note[] = [
    {
      id: "1",
      name: "LeadrPro Demo Meeting Notes",
      icon: "📝",
      lastUpdated: new Date(),
      meetingEvent: {
        title: "LeadrPro Demo: Hatica Inc <> Skuad",
        calendarColor: "#A855F7",
      },
    },
    {
      id: "2",
      name: "Product Strategy Discussion",
      icon: "💡",
      lastUpdated: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      meetingEvent: {
        title: "Product Review: Q3 Feature Planning",
        calendarColor: "#10B981",
      },
    },
    {
      id: "3",
      name: "Engineering Architecture Review",
      lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    },
    {
      id: "4",
      name: "Weekly Team Standup Notes",
      icon: "👥",
      lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      meetingEvent: {
        title: "Weekly Team Standup",
        calendarColor: "#EF4444",
      },
    },
    {
      id: "5",
      name: "Client Feedback Compilation",
      icon: "📊",
      lastUpdated: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    },
  ];

  // Determine notes based on state
  const recentNotes = notesState === "with-notes" ? mockNotes : [];

  const handleCreateNote = () => {
    // Handle creating a new note
    console.log("Creating new note...");
    // You can implement your note creation logic here
    // For example: navigate to note editor, open modal, etc.
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <NotebookText className="w-4 h-4" />
        <h2 className="text-sm font-medium">Notes</h2>
      </div>

      {notesState === "with-notes" ? (
        <div>
          {recentNotes.map((note) => (
            <NoteCard key={note.id} note={note} onNoteClick={onNoteClick} />
          ))}
        </div>
      ) : (
        <div className="border border-dashed rounded-lg p-6 text-center space-y-4">
          <NotebookText className="w-8 h-8 text-muted-foreground mx-auto" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No notes yet</p>
            <p className="text-xs text-muted-foreground">
              Create your first note to get started
            </p>
            <Button
              className="mt-4"
              size={"sm"}
              variant={"outline"}
              onClick={handleCreateNote}
            >
              <Plus className="w-4 h-4" />
              Create note
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
