import React from "react";
import { formatDistanceToNow } from "date-fns";
import { Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Note } from "../../../../../db/schema";

interface NotesListProps {
  notes: Note[];
  selectedNote: Note | null;
  onSelectNote: (note: Note) => void;
  onDeleteNote: (noteId: number) => void;
  isLoading: boolean;
}

export function NotesList({
  notes,
  selectedNote,
  onSelectNote,
  onDeleteNote,
  isLoading,
}: NotesListProps) {
  if (isLoading) {
    return (
      <ScrollArea className="h-[calc(100vh-240px)]">
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-3 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No notes yet</p>
        <p className="text-xs mt-1">Create your first note to get started</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-240px)]">
      <div className="space-y-1">
        {notes.map((note) => (
          <div
            key={note.id}
            className={`
              group relative p-3 rounded-lg cursor-pointer transition-colors
              hover:bg-accent/50
              ${selectedNote?.id === note.id ? "bg-accent" : ""}
            `}
            onClick={() => onSelectNote(note)}
          >
            <div className="pr-8">
              <h3 className="font-medium text-sm truncate">{note.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(note.updatedAt), {
                  addSuffix: true,
                })}
              </p>
            </div>

            {/* Delete button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Note</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{note.title}"? This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDeleteNote(note.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
