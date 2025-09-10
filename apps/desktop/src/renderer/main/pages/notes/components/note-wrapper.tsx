import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as Y from "yjs";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { debounce } from "../../../utils/debounce";
import Note from "./note";
import { FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type NotePageProps = {
  noteId: string;
  onBack?: () => void;
};

export default function NotePage({ noteId, onBack }: NotePageProps) {
  const navigate = useNavigate();
  const utils = api.useUtils();

  // State
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [isSyncing, setIsSyncing] = useState(true);
  const [noteIcon, setNoteIcon] = useState<string | null>(null);

  // Refs
  const ydocRef = useRef<Y.Doc | null>(null);
  const textRef = useRef<Y.Text | null>(null);
  const noteRef = useRef<typeof note>(null);

  // Fetch note data
  const { data: note, isLoading } = api.notes.getNoteById.useQuery(
    { id: parseInt(noteId) },
    {
      enabled: !!noteId,
    },
  );

  // Update title mutation
  const updateTitleMutation = api.notes.updateNoteTitle.useMutation({
    onSuccess: () => {
      utils.notes.getNotes.invalidate();
      utils.notes.getNoteById.invalidate({ id: parseInt(noteId) });
    },
  });

  // Update emoji mutation
  const updateNoteIconMutation = api.notes.updateNoteIcon.useMutation({
    onSuccess: () => {
      utils.notes.getNotes.invalidate();
      utils.notes.getNoteById.invalidate({ id: parseInt(noteId) });
      toast.success("Emoji updated");
    },
    onError: (error) => {
      toast.error("Failed to update emoji: " + error.message);
    },
  });

  // Delete mutation
  const deleteMutation = api.notes.deleteNote.useMutation({
    onSuccess: () => {
      utils.notes.getNotes.invalidate();
      // Use onBack if provided, otherwise navigate
      if (onBack) {
        onBack();
      } else {
        navigate({ to: "/settings/notes" });
      }
      toast.success("Note deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete note: " + error.message);
    },
  });

  // Debounced title update
  const debouncedUpdateTitle = useMemo(
    () =>
      debounce((title: string) => {
        const currentNote = noteRef.current;
        if (currentNote && title !== currentNote.title) {
          updateTitleMutation.mutate({ id: currentNote.id, title });
        }
      }, 500),
    [], // No dependencies - function should remain stable
  );

  // Debounced YJS update
  const debouncedYjsUpdate = useMemo(
    () =>
      debounce((newContent: string) => {
        if (textRef.current && ydocRef.current) {
          ydocRef.current.transact(() => {
            const oldLength = textRef.current!.length;
            textRef.current!.delete(0, oldLength);
            textRef.current!.insert(0, newContent);
          }, "user-input-debounced");
        }
      }, 500),
    [],
  );

  // Initialize YJS document
  useEffect(() => {
    if (!note) return;

    // Cancel any pending updates
    debouncedYjsUpdate.cancel();

    let mounted = true;

    const initializeYjs = async () => {
      try {
        // Create YJS document
        const ydoc = new Y.Doc();
        const text = ydoc.getText("content");

        // Store references
        ydocRef.current = ydoc;
        textRef.current = text;

        // Load existing updates from backend
        try {
          const updates = await window.electronAPI.notes.loadYjsUpdates(
            note.id,
          );

          if (updates.length > 0) {
            // Apply all updates to reconstruct the document
            updates.forEach((update: ArrayBuffer) => {
              Y.applyUpdate(ydoc, new Uint8Array(update));
            });

            // Set content from the reconstructed document
            const reconstructedContent = text.toString();
            setNoteBody(reconstructedContent);
          }
        } catch (error) {
          console.error("Failed to load yjs updates:", error);
        }

        setIsSyncing(false);

        // Listen for changes from YJS
        const observer = () => {
          if (!mounted) return;
          const newContent = text.toString();
          setNoteBody(newContent);
        };

        text.observe(observer);

        // Save YJS updates to backend
        ydoc.on("update", async (update: Uint8Array) => {
          try {
            // Convert Uint8Array to ArrayBuffer for IPC
            const buffer = update.buffer.slice(
              update.byteOffset,
              update.byteOffset + update.byteLength,
            );

            await window.electronAPI.notes.saveYjsUpdate(
              note.id,
              buffer as ArrayBuffer,
            );
          } catch (error) {
            console.error("Failed to save yjs update:", error);
            toast.error("Failed to save changes");
          }
        });

        // Cleanup
        return () => {
          text.unobserve(observer);
        };
      } catch (error) {
        console.error("Failed to initialize yjs:", error);
        setIsSyncing(false);
        toast.error("Failed to load note");
      }
    };

    initializeYjs();

    return () => {
      mounted = false;
      debouncedYjsUpdate.cancel();
    };
  }, [note, debouncedYjsUpdate]);

  // Update note ref and set initial title and emoji
  useEffect(() => {
    noteRef.current = note;
    if (note) {
      setNoteTitle(note.title);
      setNoteIcon(note.icon || null);
    }
  }, [note]);

  // Handle content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setNoteBody(newContent);
      debouncedYjsUpdate(newContent);
    },
    [debouncedYjsUpdate],
  );

  // Handle title change
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setNoteTitle(newTitle);
      debouncedUpdateTitle(newTitle);
    },
    [debouncedUpdateTitle],
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    deleteMutation.mutate({ id: parseInt(noteId) });
  }, [noteId, deleteMutation]);

  // Handle emoji change
  const handleEmojiChange = useCallback(
    (emoji: string | null) => {
      setNoteIcon(emoji);
      updateNoteIconMutation.mutate({ id: parseInt(noteId), icon: emoji });
    },
    [noteId, updateNoteIconMutation],
  );

  // Note not found state
  if (!isLoading && !note) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FileTextIcon className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Note not found</p>
        <Button
          variant="outline"
          onClick={() => {
            if (onBack) {
              onBack();
            } else {
              navigate({ to: "/settings/notes" });
            }
          }}
        >
          Back to notes
        </Button>
      </div>
    );
  }

  const lastEditDate = note ? new Date(note.updatedAt) : new Date();

  // Use the presentational component
  return (
    <Note
      noteId={noteId}
      noteTitle={noteTitle}
      noteBody={noteBody}
      noteEmoji={noteIcon}
      isLoading={isLoading}
      isSyncing={isSyncing}
      lastEditDate={lastEditDate}
      onTitleChange={handleTitleChange}
      onBodyChange={handleContentChange}
      onDelete={handleDelete}
      onEmojiChange={handleEmojiChange}
      onBack={onBack}
      isDeleting={deleteMutation.isPending}
    />
  );
}
