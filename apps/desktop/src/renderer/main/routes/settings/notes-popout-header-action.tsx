import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";
import { Loader2, PanelTopOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

type NotesPopoutHeaderActionProps = {
  noteId: number;
};

export function NotesPopoutHeaderAction({
  noteId,
}: NotesPopoutHeaderActionProps) {
  const { t } = useTranslation();
  const openNotesWindowMutation = api.widget.openNotesWindow.useMutation();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        openNotesWindowMutation.mutate({
          noteId,
        })
      }
      disabled={openNotesWindowMutation.isPending}
      title={t("settings.notes.note.actions.openInNotesWindow")}
      aria-label={t("settings.notes.note.actions.openInNotesWindow")}
    >
      {openNotesWindowMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <PanelTopOpen className="h-4 w-4" />
      )}
    </Button>
  );
}
