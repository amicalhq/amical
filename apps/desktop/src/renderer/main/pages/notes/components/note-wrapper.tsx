import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { debounce } from "@/renderer/main/utils/debounce";
import Note from "./note";
import { NoteEditor } from "./note-editor";
import { FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type NotePageProps = {
  noteId: string;
  onBack?: () => void;
  autoRecord?: boolean;
};

export default function NotePage({
  noteId,
  onBack,
  autoRecord,
}: NotePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = api.useUtils();
  const startRecordingMutation = api.recording.signalStart.useMutation();

  // State
  const [noteTitle, setNoteTitle] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [noteIcon, setNoteIcon] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  // Refs
  const noteRef = useRef<typeof note>(null);
  const autoRecordTriggeredRef = useRef(false);

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
      toast.success(t("settings.notes.toast.emojiUpdated"));
    },
    onError: (error) => {
      toast.error(
        t("settings.notes.toast.emojiUpdateFailed", { message: error.message }),
      );
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
      toast.success(t("settings.notes.toast.deleted"));
    },
    onError: (error) => {
      toast.error(
        t("settings.notes.toast.deleteFailed", { message: error.message }),
      );
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

  // Update note ref and set initial title and emoji
  useEffect(() => {
    noteRef.current = note;
    if (note) {
      setNoteTitle(note.title);
      setNoteIcon(note.icon || null);
    }
  }, [note]);

  // Handle sync status change from NoteEditor
  const handleSyncStatusChange = useCallback((syncing: boolean) => {
    setIsSyncing(syncing);
  }, []);

  // Reset state when noteId changes
  useEffect(() => {
    setEditorReady(false);
    autoRecordTriggeredRef.current = false;
  }, [noteId]);

  // Handle editor ready
  const handleEditorReady = useCallback(() => {
    setEditorReady(true);
  }, []);

  // Auto-start recording when editor is ready and autoRecord flag is set
  useEffect(() => {
    if (editorReady && autoRecord && !autoRecordTriggeredRef.current) {
      autoRecordTriggeredRef.current = true;
      startRecordingMutation.mutateAsync().catch((error) => {
        console.error("Failed to auto-start recording:", error);
      });
    }
  }, [editorReady, autoRecord, startRecordingMutation]);

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
        <p className="text-muted-foreground">{t("settings.notes.notFound")}</p>
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
          {t("settings.notes.backToNotes")}
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
      noteEmoji={noteIcon}
      isLoading={isLoading}
      isSyncing={isSyncing}
      lastEditDate={lastEditDate}
      onTitleChange={handleTitleChange}
      onDelete={handleDelete}
      onEmojiChange={handleEmojiChange}
      onBack={onBack}
      isDeleting={deleteMutation.isPending}
    >
      <NoteEditor
        noteId={parseInt(noteId)}
        onSyncStatusChange={handleSyncStatusChange}
        onReady={handleEditorReady}
      />
    </Note>
  );
}
