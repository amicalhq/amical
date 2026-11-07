import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import Note from "./note";
import { NoteEditor } from "./note-editor";
import { FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useNoteTitleSave } from "@/renderer/main/hooks/use-note-title-save";

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
  const { pendingTitle, setPendingTitle } = useNoteTitleSave(
    noteId,
    (saved) => {
      if (noteRef.current?.id === saved.id)
        noteRef.current = {
          ...noteRef.current,
          title: saved.title,
          remoteVersion: saved.remoteVersion,
        };
    },
    (id) => {
      if (noteRef.current?.id === id && !pendingTitle.current)
        setNoteTitle(noteRef.current.title);
    },
  );

  // Fetch note data
  const {
    data: note,
    isLoading,
    isError,
  } = api.notes.getNoteById.useQuery(
    { id: noteId },
    {
      enabled: !!noteId,
    },
  );

  // Update emoji mutation
  const updateNoteIconMutation = api.notes.updateNoteIcon.useMutation({
    onSuccess: () => {
      utils.notes.getNotes.invalidate();
      utils.notes.getNoteById.invalidate({ id: noteId });
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
        navigate({ to: "/notes" });
      }
      toast.success(t("settings.notes.toast.deleted"));
    },
    onError: (error) => {
      toast.error(
        t("settings.notes.toast.deleteFailed", { message: error.message }),
      );
    },
  });

  // Update note ref and set initial title and emoji
  useEffect(() => {
    noteRef.current = note;
    if (note) {
      setNoteTitle(pendingTitle.current?.title ?? note.title);
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
      const remoteVersion = pendingTitle.current
        ? pendingTitle.current.remoteVersion
        : (noteRef.current?.remoteVersion ?? null);
      const originalTitle = pendingTitle.current?.originalTitle ?? noteTitle;
      setPendingTitle({
        id: noteId,
        title: newTitle,
        remoteVersion,
        originalTitle,
      });
    },
    [setPendingTitle, noteTitle, noteId],
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    deleteMutation.mutate({ id: noteId });
  }, [noteId, deleteMutation]);

  // Handle emoji change
  const handleEmojiChange = useCallback(
    (emoji: string | null) => {
      setNoteIcon(emoji);
      updateNoteIconMutation.mutate({
        id: noteId,
        icon: emoji,
        expectedRemoteVersion: noteRef.current?.remoteVersion,
        originalIcon: noteIcon,
      });
    },
    [noteId, noteIcon, updateNoteIconMutation],
  );

  // Note not found state
  if (!isLoading && (!note || isError)) {
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
              navigate({ to: "/notes" });
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
      {note?.syncError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {t("settings.notes.cloud.error", { reason: note.syncError })}
        </p>
      )}
      <NoteEditor
        noteId={noteId}
        onSyncStatusChange={handleSyncStatusChange}
        onReady={handleEditorReady}
      />
    </Note>
  );
}
