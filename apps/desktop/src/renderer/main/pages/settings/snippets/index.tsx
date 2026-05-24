import { useState } from "react";
import { Plus, Edit, Trash2, MoveRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Snippet as SnippetItem } from "@/db/schema";
import {
  CONTENT_MAX_LENGTH,
  SNIPPET_ERROR_DUPLICATE_TRIGGER,
  TRIGGER_MAX_LENGTH,
} from "@/constants/snippets";

interface SnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  formData: { trigger: string; content: string };
  onFormDataChange: (data: { trigger: string; content: string }) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

function SnippetDialog({
  open,
  onOpenChange,
  mode,
  formData,
  onFormDataChange,
  onSubmit,
  isLoading = false,
}: SnippetDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "add"
              ? t("settings.snippets.dialog.addTitle")
              : t("settings.snippets.dialog.editTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="snippet-trigger">
              {t("settings.snippets.dialog.triggerLabel")}
            </Label>
            <Input
              id="snippet-trigger"
              placeholder={t("settings.snippets.dialog.triggerPlaceholder")}
              value={formData.trigger}
              maxLength={TRIGGER_MAX_LENGTH}
              onChange={(e) =>
                onFormDataChange({ ...formData, trigger: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="snippet-content">
              {t("settings.snippets.dialog.contentLabel")}
            </Label>
            <Textarea
              id="snippet-content"
              className="min-h-32 max-h-[40vh] resize-none overflow-y-auto [field-sizing:fixed] [overflow-wrap:anywhere]"
              placeholder={t("settings.snippets.dialog.contentPlaceholder")}
              value={formData.content}
              maxLength={CONTENT_MAX_LENGTH}
              onChange={(e) =>
                onFormDataChange({ ...formData, content: e.target.value })
              }
            />
          </div>

          <DialogFooter className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("settings.snippets.dialog.cancel")}
            </Button>
            <Button
              onClick={onSubmit}
              disabled={!formData.trigger || !formData.content || isLoading}
            >
              {isLoading
                ? t("settings.snippets.dialog.saving")
                : mode === "add"
                  ? t("settings.snippets.dialog.addSnippet")
                  : t("settings.snippets.dialog.saveChanges")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deletingItem: SnippetItem | null;
  onConfirm: () => void;
  isLoading?: boolean;
}

function DeleteDialog({
  open,
  onOpenChange,
  deletingItem,
  onConfirm,
  isLoading = false,
}: DeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.snippets.delete.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.snippets.delete.description", {
              trigger: deletingItem?.trigger ?? "",
            })}
          </p>
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.snippets.delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading
              ? t("settings.snippets.delete.deleting")
              : t("settings.snippets.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function truncate(text: string, max = 80) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max).trimEnd()}…` : single;
}

export default function SnippetsSettingsPage() {
  const { t } = useTranslation();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SnippetItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<SnippetItem | null>(null);
  const [formData, setFormData] = useState({ trigger: "", content: "" });
  const [searchTerm, setSearchTerm] = useState("");

  const trimmedSearch = searchTerm.trim();
  const snippetsQuery = api.snippets.getSnippets.useQuery({
    limit: 200,
    search: trimmedSearch || undefined,
  });

  const snippetItems = snippetsQuery.data || [];
  const snippetsLoading = snippetsQuery.isLoading;

  const utils = api.useUtils();
  const createSnippetMutation = api.snippets.createSnippet.useMutation({
    onSuccess: (data) => {
      utils.snippets.getSnippets.invalidate();
      if (data?.similarTrigger) {
        toast.success(t("settings.snippets.toast.added"), {
          description: t("settings.snippets.toast.similarToExisting", {
            trigger: data.similarTrigger,
          }),
        });
      } else {
        toast.success(t("settings.snippets.toast.added"));
      }
    },
    onError: (error, variables) => {
      if (error.message === SNIPPET_ERROR_DUPLICATE_TRIGGER) {
        toast.error(
          t("settings.snippets.toast.duplicateTrigger", {
            trigger: variables.trigger,
          }),
        );
        return;
      }
      toast.error(
        t("settings.snippets.toast.addFailed", { message: error.message }),
      );
    },
  });

  const updateSnippetMutation = api.snippets.updateSnippet.useMutation({
    onSuccess: () => {
      utils.snippets.getSnippets.invalidate();
      toast.success(t("settings.snippets.toast.updated"));
    },
    onError: (error, variables) => {
      if (error.message === SNIPPET_ERROR_DUPLICATE_TRIGGER) {
        toast.error(
          t("settings.snippets.toast.duplicateTrigger", {
            trigger: variables.data.trigger ?? "",
          }),
        );
        return;
      }
      toast.error(
        t("settings.snippets.toast.updateFailed", { message: error.message }),
      );
    },
  });

  const deleteSnippetMutation = api.snippets.deleteSnippet.useMutation({
    onSuccess: () => {
      utils.snippets.getSnippets.invalidate();
      toast.success(t("settings.snippets.toast.deleted"));
    },
    onError: (error) => {
      toast.error(
        t("settings.snippets.toast.deleteFailed", { message: error.message }),
      );
    },
  });

  const handleAddSnippet = async () => {
    try {
      await createSnippetMutation.mutateAsync({
        trigger: formData.trigger,
        content: formData.content,
      });
      setFormData({ trigger: "", content: "" });
      setIsAddDialogOpen(false);
    } catch {
      // mutation onError handles user feedback; keep dialog open for retry
    }
  };

  const handleEditSnippet = async () => {
    if (!editingItem) return;

    try {
      await updateSnippetMutation.mutateAsync({
        id: editingItem.id,
        data: {
          trigger: formData.trigger,
          content: formData.content,
        },
      });
      setFormData({ trigger: "", content: "" });
      setEditingItem(null);
      setIsEditDialogOpen(false);
    } catch {
      // mutation onError handles user feedback; keep dialog open for retry
    }
  };

  const handleDeleteSnippet = async () => {
    if (!deletingItem) return;

    try {
      await deleteSnippetMutation.mutateAsync({ id: deletingItem.id });
      setDeletingItem(null);
      setIsDeleteDialogOpen(false);
    } catch {
      // mutation onError handles user feedback; keep dialog open for retry
    }
  };

  const openEditDialog = (item: SnippetItem) => {
    setEditingItem(item);
    setFormData({ trigger: item.trigger, content: item.content });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (item: SnippetItem) => {
    setDeletingItem(item);
    setIsDeleteDialogOpen(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold">{t("settings.snippets.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("settings.snippets.description")}
          </p>
        </div>

        <Button
          onClick={() => {
            setFormData({ trigger: "", content: "" });
            setIsAddDialogOpen(true);
          }}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t("settings.snippets.addButton")}
        </Button>
      </div>

      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 pointer-events-none" />
        <Input
          placeholder={t("settings.snippets.search.placeholder")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      <Card className="p-0 overflow-clip">
        <CardContent className="p-0">
          {snippetsLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("settings.snippets.loading")}
            </div>
          ) : snippetItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {trimmedSearch
                ? t("settings.snippets.noResults", { query: trimmedSearch })
                : t("settings.snippets.empty")}
            </div>
          ) : (
            <div className="space-y-0">
              {snippetItems.map((item, index) => (
                <div
                  className="hover:bg-muted/50 transition-colors"
                  key={item.id}
                >
                  <div className="flex items-center justify-between py-3 px-4 group gap-4">
                    <div className="flex items-center gap-1 text-sm min-w-0 flex-1">
                      <span className="shrink-0 font-medium">
                        {item.trigger}
                      </span>
                      <MoveRight className="w-4 h-4 mx-2 shrink-0 text-muted-foreground" />
                      <span className="truncate text-muted-foreground">
                        {truncate(item.content)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(item)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeleteDialog(item)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {index < snippetItems.length - 1 && (
                    <div className="border-t border-border" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SnippetDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        mode="add"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleAddSnippet}
        isLoading={createSnippetMutation.isPending}
      />

      <SnippetDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mode="edit"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleEditSnippet}
        isLoading={updateSnippetMutation.isPending}
      />

      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        deletingItem={deletingItem}
        onConfirm={handleDeleteSnippet}
        isLoading={deleteSnippetMutation.isPending}
      />
    </div>
  );
}
