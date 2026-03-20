import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Loader2, Plus, X } from "lucide-react";
import { api } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { debounce } from "@/renderer/main/utils/debounce";
import { NoteEditor } from "@/renderer/main/pages/notes/components/note-editor";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface NotesWindowPanelProps {
  initialNoteId?: number;
  shouldCreateInitialNote?: boolean;
}

export function NotesWindowPanel({
  initialNoteId,
  shouldCreateInitialNote = false,
}: NotesWindowPanelProps): ReactNode {
  const { t, i18n } = useTranslation();
  const utils = api.useUtils();
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const createNoteMutation = api.notes.createNote.useMutation();
  const updateNoteTitleMutation = api.notes.updateNoteTitle.useMutation();
  const closeNotesWindowMutation = api.widget.closeNotesWindow.useMutation();
  const startRecordingMutation = api.recording.signalStart.useMutation();

  const [currentNoteId, setCurrentNoteId] = useState<number | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [editorReady, setEditorReady] = useState(false);

  const autoRecordPendingNoteIdRef = useRef<number | null>(null);
  const autoRecordStartedNoteIdRef = useRef<number | null>(null);
  const updateNoteTitleMutateRef = useRef(updateNoteTitleMutation.mutate);

  const createAndSwitchToNewNote = useCallback(async () => {
    if (createNoteMutation.isPending) {
      return;
    }

    const dateStr = new Date().toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
    });

    try {
      const note = await createNoteMutation.mutateAsync({
        title: t("settings.notes.defaultTitleWithDate", { date: dateStr }),
      });

      setCurrentNoteId(note.id);
      setNoteTitle(note.title);
      setEditorReady(false);

      let autoRecord = preferencesQuery.data?.autoDictateOnNewNote;
      if (autoRecord === undefined) {
        try {
          const prefs = await utils.settings.getPreferences.fetch();
          autoRecord = prefs?.autoDictateOnNewNote;
        } catch {
          autoRecord = false;
        }
      }

      autoRecordStartedNoteIdRef.current = null;
      autoRecordPendingNoteIdRef.current = autoRecord ? note.id : null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("errors.generic");
      toast.error(t("settings.notes.toast.createFailed", { message }));
    }
  }, [
    createNoteMutation,
    i18n.language,
    preferencesQuery.data,
    t,
    utils.settings.getPreferences,
  ]);

  const openAndSwitchToExistingNote = useCallback(
    async (noteId: number) => {
      try {
        const note = await utils.notes.getNoteById.fetch({ id: noteId });
        if (!note) {
          toast.error(t("settings.notes.notFound"));
          return;
        }

        setCurrentNoteId(note.id);
        setNoteTitle(note.title);
        setEditorReady(false);
        autoRecordPendingNoteIdRef.current = null;
        autoRecordStartedNoteIdRef.current = null;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("errors.generic");
        toast.error(t("settings.notes.toast.loadFailed", { message }));
      }
    },
    [t, utils.notes.getNoteById],
  );

  const handleOpenRequest = useCallback(
    (noteId?: number) => {
      if (typeof noteId === "number" && Number.isFinite(noteId) && noteId > 0) {
        void openAndSwitchToExistingNote(noteId);
        return;
      }

      void createAndSwitchToNewNote();
    },
    [createAndSwitchToNewNote, openAndSwitchToExistingNote],
  );

  useEffect(() => {
    const handler = (noteId?: number) => {
      handleOpenRequest(noteId);
    };

    window.electronAPI.on("notes-window:open-requested", handler);
    return () => {
      window.electronAPI.off("notes-window:open-requested", handler);
    };
  }, [handleOpenRequest]);

  useEffect(() => {
    updateNoteTitleMutateRef.current = updateNoteTitleMutation.mutate;
  }, [updateNoteTitleMutation.mutate]);

  useEffect(() => {
    if (typeof initialNoteId === "number" && initialNoteId > 0) {
      handleOpenRequest(initialNoteId);
      return;
    }
    if (shouldCreateInitialNote) {
      handleOpenRequest(undefined);
    }
  }, [handleOpenRequest, initialNoteId, shouldCreateInitialNote]);

  const debouncedUpdateTitle = useMemo(
    () =>
      debounce((id: number, title: string) => {
        updateNoteTitleMutateRef.current({ id, title });
      }, 500),
    [],
  );

  useEffect(() => {
    return () => {
      debouncedUpdateTitle.cancel();
    };
  }, [debouncedUpdateTitle]);

  useEffect(() => {
    if (!editorReady || currentNoteId === null) {
      return;
    }
    if (autoRecordPendingNoteIdRef.current !== currentNoteId) {
      return;
    }
    if (autoRecordStartedNoteIdRef.current === currentNoteId) {
      return;
    }

    autoRecordStartedNoteIdRef.current = currentNoteId;
    startRecordingMutation.mutateAsync().catch((error) => {
      console.error("Failed to auto-start recording in notes window", error);
    });
  }, [currentNoteId, editorReady, startRecordingMutation]);

  const handleTitleChange = (value: string) => {
    setNoteTitle(value);
    if (currentNoteId !== null) {
      debouncedUpdateTitle(currentNoteId, value);
    }
  };

  const handleClose = async () => {
    try {
      await closeNotesWindowMutation.mutateAsync();
    } catch (error) {
      console.error("Failed to close notes window widget", error);
    }
  };

  const headerTitle =
    currentNoteId === null
      ? createNoteMutation.isPending
        ? t("loading")
        : t("settings.notes.note.titlePlaceholder")
      : noteTitle.trim().length > 0
        ? noteTitle
        : t("settings.notes.note.titlePlaceholder");
  const headerTitleInputWidthCh = Math.max(
    12,
    Math.min(36, headerTitle.length + 1),
  );

  return (
    <div className="h-full w-full p-[1px]">
      <div className="h-full w-full rounded-[22px] overflow-hidden border border-border/60 bg-background">
        <div
          className="h-12 px-4 border-b border-border/60 flex items-center justify-between gap-3"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        >
          {currentNoteId === null ? (
            <p className="text-sm font-medium text-foreground truncate pr-3 flex-1 min-w-0">
              {headerTitle}
            </p>
          ) : (
            <Input
              value={noteTitle}
              onChange={(event) => handleTitleChange(event.target.value)}
              className="h-8 text-sm font-medium border-0 px-0 bg-transparent dark:bg-transparent rounded-none shadow-none focus-visible:ring-0 focus-visible:border-0"
              placeholder={t("settings.notes.note.titlePlaceholder")}
              style={
                {
                  WebkitAppRegion: "no-drag",
                  width: `${headerTitleInputWidthCh}ch`,
                } as CSSProperties
              }
            />
          )}
          <div
            className="flex items-center gap-2"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={() => void createAndSwitchToNewNote()}
              disabled={createNoteMutation.isPending}
              aria-label={t("settings.notes.create")}
            >
              {createNoteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={() => void handleClose()}
              aria-label={t("settings.notes.backToNotes")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="h-[calc(100%-3rem)] flex flex-col min-h-0">
          <div className="px-4 py-3 flex-1 min-h-0">
            {currentNoteId === null ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                {createNoteMutation.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("loading")}
                  </span>
                ) : (
                  t("settings.notes.empty.description")
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col min-h-0">
                <div
                  className="flex-1 min-h-0 overflow-y-auto"
                  style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
                >
                  <NoteEditor
                    noteId={currentNoteId}
                    onReady={() => setEditorReady(true)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
