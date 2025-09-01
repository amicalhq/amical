import React, { useState, useEffect } from "react";
import { Plus, Search, FileText, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NotesList } from "./components/NotesList";
import { NoteEditor } from "./components/NoteEditor";
import type { Note } from "../../../../db/schema";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"updatedAt" | "title" | "createdAt">(
    "updatedAt",
  );
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [isLoading, setIsLoading] = useState(true);

  // Load notes
  useEffect(() => {
    loadNotes();
  }, [searchQuery, sortBy, sortOrder]);

  const loadNotes = async () => {
    setIsLoading(true);
    try {
      const notesList = await window.electronAPI.notes.list({
        search: searchQuery || undefined,
        sortBy,
        sortOrder,
        limit: 100,
      });
      setNotes(notesList);
    } catch (error) {
      console.error("Failed to load notes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNote = async () => {
    try {
      const newNote = await window.electronAPI.notes.create({
        title: "New Note",
        initialContent: "",
      });
      setNotes([newNote, ...notes]);
      setSelectedNote(newNote);
    } catch (error) {
      console.error("Failed to create note:", error);
    }
  };

  const handleSelectNote = async (note: Note) => {
    setSelectedNote(note);
  };

  const handleUpdateNote = async (
    noteId: number,
    updates: { title?: string },
  ) => {
    try {
      const updatedNote = await window.electronAPI.notes.update(
        noteId,
        updates,
      );
      if (updatedNote) {
        setNotes(notes.map((n) => (n.id === noteId ? updatedNote : n)));
        if (selectedNote?.id === noteId) {
          setSelectedNote(updatedNote);
        }
      }
    } catch (error) {
      console.error("Failed to update note:", error);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    try {
      await window.electronAPI.notes.delete(noteId);
      setNotes(notes.filter((n) => n.id !== noteId));
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
      }
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  return (
    <div className="flex h-full">
      {/* Notes List Sidebar */}
      <div className="w-80 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="p-4 space-y-4">
          {/* Header with Create Button */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Notes</h2>
            <Button onClick={handleCreateNote} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Note
            </Button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Sort Options */}
          <div className="flex gap-2">
            <Select
              value={sortBy}
              onValueChange={(value: any) => setSortBy(value)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">
                  <Clock className="h-3 w-3 inline mr-1" />
                  Last Modified
                </SelectItem>
                <SelectItem value="createdAt">
                  <Calendar className="h-3 w-3 inline mr-1" />
                  Date Created
                </SelectItem>
                <SelectItem value="title">
                  <FileText className="h-3 w-3 inline mr-1" />
                  Title
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              {sortOrder === "asc" ? "↑" : "↓"}
            </Button>
          </div>

          {/* Notes List */}
          <NotesList
            notes={notes}
            selectedNote={selectedNote}
            onSelectNote={handleSelectNote}
            onDeleteNote={handleDeleteNote}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Note Editor */}
      <div className="flex-1">
        {selectedNote ? (
          <NoteEditor
            note={selectedNote}
            onUpdateTitle={(title) =>
              handleUpdateNote(selectedNote.id, { title })
            }
            onClose={() => setSelectedNote(null)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a note to edit or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
