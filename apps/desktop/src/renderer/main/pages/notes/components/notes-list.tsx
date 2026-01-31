import { NotebookText } from "lucide-react";
import { NoteCard } from "./note-card";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "@tanstack/react-router";

export function NotesList() {
  const navigate = useNavigate();

  const { data: notes, isLoading } = api.notes.getNotes.useQuery({
    sortBy: "updatedAt",
    sortOrder: "desc",
  });

  const onNoteClick = (noteId: number) => {
    navigate({
      to: "/settings/notes/$noteId",
      params: { noteId: String(noteId) },
      search: {}, // Clear search params to prevent autoRecord from persisting
    });
  };

  // Convert database notes to UI format
  const formattedNotes = notes || [];

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <NotebookText className="w-4 h-4" />
          <h2 className="text-sm font-medium">Notes</h2>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 py-2 px-3">
              <Skeleton className="w-5 h-5 mt-0.5" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <NotebookText className="w-4 h-4" />
        <h2 className="text-sm font-medium">Notes</h2>
      </div>

      {formattedNotes.length > 0 && (
        <div>
          {formattedNotes.map((note) => (
            <NoteCard key={note.id} note={note} onNoteClick={onNoteClick} />
          ))}
        </div>
      )}

      {formattedNotes.length === 0 && (
        <div className="border border-dashed rounded-lg p-6 text-center space-y-4">
          <NotebookText className="w-8 h-8 text-muted-foreground mx-auto" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No notes yet</p>
            <p className="text-xs text-muted-foreground">
              Click "+ Note" in the header to create your first note
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
