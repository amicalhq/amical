import { useEffect, useMemo } from "react";
import { settleTitleSave, type NoteTitleDraft } from "@/notes/title-draft";
import { api } from "@/trpc/react";
import { debounce } from "../utils/debounce";

type SavedTitle = Pick<NoteTitleDraft, "id" | "title" | "remoteVersion">;
type TitleSaveDependencies = {
  mutation: ReturnType<typeof api.notes.updateNoteTitle.useMutation>;
  utils: ReturnType<typeof api.useUtils>;
  onSaved?: (saved: SavedTitle) => void;
  onReverted?: (id: string) => void;
};

// Keep one writer for each note, including failed saves after navigation.
const titleSaves = new Map<string, ReturnType<typeof createTitleSave>>();

function createTitleSave(dependencies: TitleSaveDependencies) {
  const latest = { current: dependencies };
  // A previous note keeps its draft until navigation finishes saving it.
  const pendingTitle = { current: null as NoteTitleDraft | null };
  const inFlight = { current: null as Promise<boolean> | null };
  const save = (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const pending = pendingTitle.current;
    if (!pending) return Promise.resolve(true);
    if (pending.title === pending.originalTitle) {
      pendingTitle.current = null;
      latest.current.onReverted?.(pending.id);
      void latest.current.utils.notes.getNoteById.invalidate({
        id: pending.id,
      });
      return Promise.resolve(true);
    }
    const saving = latest.current.mutation
      .mutateAsync({
        id: pending.id,
        title: pending.title,
        expectedRemoteVersion: pending.remoteVersion,
        originalTitle: pending.originalTitle,
      })
      .then(
        (saved) => {
          pendingTitle.current = settleTitleSave(
            pendingTitle.current,
            pending,
            saved,
          );
          latest.current.onSaved?.(saved);
          void latest.current.utils.notes.getNotes.invalidate();
          void latest.current.utils.notes.getNoteById.invalidate({
            id: pending.id,
          });
          return true;
        },
        () => false,
      )
      .then((saved) => {
        inFlight.current = null;
        const next = pendingTitle.current;
        if (next && (saved || next.title !== pending.title))
          debouncedUpdateTitle();
        return saved;
      });
    inFlight.current = saving;
    return saving;
  };
  const debouncedUpdateTitle = debounce(() => void save(), 250);
  const flush = async () => {
    debouncedUpdateTitle.cancel();
    if (inFlight.current) await inFlight.current;
    debouncedUpdateTitle.cancel();
    while (pendingTitle.current) {
      const saved = await save();
      debouncedUpdateTitle.cancel();
      if (!saved) return;
    }
  };
  return {
    pendingTitle,
    inFlight,
    flush,
    setPendingTitle: (draft: NoteTitleDraft | null) => {
      pendingTitle.current = draft;
      if (draft) debouncedUpdateTitle();
      else debouncedUpdateTitle.cancel();
    },
    latest,
    mounted: 0,
    cleanup: undefined as (() => void) | undefined,
  };
}

export function useNoteTitleSave(
  noteId: string | null,
  onSaved?: (saved: SavedTitle) => void,
  onReverted?: (id: string) => void,
) {
  const mutation = api.notes.updateNoteTitle.useMutation();
  const utils = api.useUtils();
  const dependencies = { mutation, utils, onSaved, onReverted };
  const saver = useMemo(
    () => (noteId && titleSaves.get(noteId)) || createTitleSave(dependencies),
    [noteId],
  );
  saver.latest.current = dependencies;
  const { pendingTitle, inFlight, flush, setPendingTitle } = saver;

  useEffect(() => {
    if (noteId === null) return;
    titleSaves.set(noteId, saver);
    saver.mounted++;
    if (!saver.cleanup) {
      const cleanup = () => {
        if (saver.mounted || pendingTitle.current || inFlight.current) return;
        unsubscribe();
        titleSaves.delete(noteId);
        saver.cleanup = undefined;
      };
      const unsubscribe = window.electronAPI.notes.onBodyChange((change) => {
        if (change.deleted && change.noteId === noteId) {
          setPendingTitle(null);
          cleanup();
        }
      });
      saver.cleanup = cleanup;
    }
    return () => {
      saver.mounted--;
      if (saver.mounted) return;
      if (pendingTitle.current || inFlight.current)
        void flush().finally(() => saver.cleanup?.());
      else saver.cleanup?.();
    };
  }, [noteId, saver]);

  return { pendingTitle, setPendingTitle };
}
