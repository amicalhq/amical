import { useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function CreateNoteButton() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const utils = api.useUtils();
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const isMac =
    typeof window !== "undefined" && window.electronAPI?.platform === "darwin";

  const createNoteMutation = api.notes.createNote.useMutation({
    onSuccess: async (newNote) => {
      utils.notes.getNotes.invalidate();
      let autoRecord = preferencesQuery.data?.autoDictateOnNewNote;
      if (autoRecord === undefined) {
        try {
          const prefs = await utils.settings.getPreferences.fetch();
          autoRecord = prefs?.autoDictateOnNewNote;
        } catch {
          autoRecord = false;
        }
      }
      navigate({
        to: "/settings/notes/$noteId",
        params: { noteId: String(newNote.id) },
        search: autoRecord ? { autoRecord: true } : {},
      });
    },
    onError: (error) => {
      toast.error(
        t("settings.notes.toast.createFailed", { message: error.message }),
      );
    },
  });

  const onCreateNote = useCallback(() => {
    if (createNoteMutation.isPending) return;
    const dateStr = new Date().toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
    });
    createNoteMutation.mutate({
      title: t("settings.notes.defaultTitleWithDate", { date: dateStr }),
    });
  }, [createNoteMutation, i18n.language, t]);

  // Keyboard shortcut: Cmd+N (Mac) / Ctrl+N (Windows/Linux)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onCreateNote();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCreateNote]);

  const shortcutDisplay = isMac ? "⌘ N" : "Ctrl+N";

  return (
    <SidebarMenuButton
      className="border border-sidebar-border"
      onClick={onCreateNote}
      disabled={createNoteMutation.isPending}
    >
      <Plus />
      <span>{t("settings.notes.create")}</span>
      <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-auto">
        {shortcutDisplay}
      </kbd>
    </SidebarMenuButton>
  );
}
