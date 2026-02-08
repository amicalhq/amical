import { useState } from "react";
import { Plus, Edit, Trash2, Info, MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";

type VocabularyItem = {
  id: number;
  word: string;
  replacementWord?: string | null;
  isReplacement: boolean | null;
  dateAdded: Date;
  usageCount: number | null;
  createdAt: Date;
  updatedAt: Date;
};

// Add/Edit Dialog Component
interface VocabularyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  formData: {
    word: string;
    replacementWord: string;
    isReplacement: boolean;
  };
  onFormDataChange: (data: {
    word: string;
    replacementWord: string;
    isReplacement: boolean;
  }) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

function VocabularyDialog({
  open,
  onOpenChange,
  mode,
  formData,
  onFormDataChange,
  onSubmit,
  isLoading = false,
}: VocabularyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add to vocabulary" : "Edit vocabulary"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label htmlFor="replacement-toggle">Make it a replacement</Label>
              <Info className="w-4 h-4 text-muted-foreground" />
            </div>
            <Switch
              id="replacement-toggle"
              checked={formData.isReplacement}
              onCheckedChange={(checked) =>
                onFormDataChange({ ...formData, isReplacement: checked })
              }
            />
          </div>

          {formData.isReplacement ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Misspelling"
                  value={formData.word}
                  onChange={(e) =>
                    onFormDataChange({ ...formData, word: e.target.value })
                  }
                />
                <span className="text-muted-foreground">→</span>
                <Input
                  placeholder="Correct spelling"
                  value={formData.replacementWord}
                  onChange={(e) =>
                    onFormDataChange({
                      ...formData,
                      replacementWord: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <Input
              placeholder="Add a new word"
              value={formData.word}
              onChange={(e) =>
                onFormDataChange({ ...formData, word: e.target.value })
              }
            />
          )}

          <DialogFooter className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              disabled={
                !formData.word.trim() ||
                (formData.isReplacement && !formData.replacementWord.trim()) ||
                isLoading
              }
            >
              {isLoading
                ? "Saving..."
                : mode === "add"
                  ? "Add word"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Delete Confirmation Dialog Component
interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deletingItem: VocabularyItem | null;
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete vocabulary item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete "
            {deletingItem?.isReplacement
              ? `${deletingItem?.word} → ${deletingItem?.replacementWord}`
              : deletingItem?.word}
            "? This action cannot be undone.
          </p>
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VocabularySettingsPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VocabularyItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<VocabularyItem | null>(null);
  const [formData, setFormData] = useState({
    word: "",
    replacementWord: "",
    isReplacement: false,
  });

  const vocabularyQuery = api.vocabulary.getVocabulary.useQuery({
    limit: 100,
    offset: 0,
    sortBy: "dateAdded",
    sortOrder: "desc",
  });

  const vocabularyItems = vocabularyQuery.data || [];
  const vocabularyLoading = vocabularyQuery.isLoading;

  // tRPC mutations
  const utils = api.useUtils();
  const createVocabularyMutation =
    api.vocabulary.createVocabularyWord.useMutation({
      onSuccess: () => {
        utils.vocabulary.getVocabulary.invalidate();
        toast.success("Word added to vocabulary");
      },
      onError: (error) => {
        toast.error(`Failed to add word: ${error.message}`);
      },
    });

  const updateVocabularyMutation = api.vocabulary.updateVocabulary.useMutation({
    onSuccess: () => {
      utils.vocabulary.getVocabulary.invalidate();
      toast.success("Vocabulary updated");
    },
    onError: (error) => {
      toast.error(`Failed to update word: ${error.message}`);
    },
  });

  const deleteVocabularyMutation = api.vocabulary.deleteVocabulary.useMutation({
    onSuccess: () => {
      utils.vocabulary.getVocabulary.invalidate();
      toast.success("Word deleted from vocabulary");
    },
    onError: (error) => {
      toast.error(`Failed to delete word: ${error.message}`);
    },
  });

  const handleAddWord = async () => {
    try {
      await createVocabularyMutation.mutateAsync({
        word: formData.word,
        isReplacement: formData.isReplacement,
        replacementWord: formData.isReplacement
          ? formData.replacementWord
          : undefined,
      });
      setFormData({ word: "", replacementWord: "", isReplacement: false });
      setIsAddDialogOpen(false);
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep dialog open so user can retry
    }
  };

  const handleEditWord = async () => {
    if (!editingItem) return;

    try {
      await updateVocabularyMutation.mutateAsync({
        id: editingItem.id,
        data: {
          word: formData.word,
          isReplacement: formData.isReplacement,
          replacementWord: formData.isReplacement
            ? formData.replacementWord
            : undefined,
        },
      });
      setFormData({ word: "", replacementWord: "", isReplacement: false });
      setEditingItem(null);
      setIsEditDialogOpen(false);
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep dialog open so user can retry
    }
  };

  const handleDeleteWord = async () => {
    if (!deletingItem) return;

    try {
      await deleteVocabularyMutation.mutateAsync({
        id: deletingItem.id,
      });
      setDeletingItem(null);
      setIsDeleteDialogOpen(false);
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep dialog open so user can retry
    }
  };

  const openEditDialog = (item: VocabularyItem) => {
    setEditingItem(item);
    setFormData({
      word: item.word,
      replacementWord: item.replacementWord || "",
      isReplacement: item.isReplacement || false,
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (item: VocabularyItem) => {
    setDeletingItem(item);
    setIsDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ word: "", replacementWord: "", isReplacement: false });
    setEditingItem(null);
  };

  return (
    <div className="container mx-auto max-w-5xl px-6 pb-6">
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold">Dictionary</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your custom vocabulary and word replacements for dictation.
          </p>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button
              onClick={() => resetForm()}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Word
            </Button>
          </DialogTrigger>
        </Dialog>
      </div>

      {/* Vocabulary List */}
      <Card className="p-0 overflow-clip">
        <CardContent className="p-0">
          {vocabularyLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading vocabulary...
            </div>
          ) : vocabularyItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No vocabulary words found. Add your first word to get started.
            </div>
          ) : (
            <div className="space-y-0">
              {vocabularyItems.map((item, index) => (
                <div
                  className="hover:bg-muted/50 transition-colors"
                  key={item.id}
                >
                  <div className="flex items-center justify-between py-3 px-4 group">
                    <span className="text-sm flex items-center gap-1">
                      {item.isReplacement ? (
                        <>
                          <span>{item.word}</span>
                          <MoveRight className="w-4 h-4 mx-2" />
                          <span>{item.replacementWord}</span>
                        </>
                      ) : (
                        item.word
                      )}
                    </span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  {index < vocabularyItems.length - 1 && (
                    <div className="border-t border-border" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Components */}
      <VocabularyDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        mode="add"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleAddWord}
        isLoading={createVocabularyMutation.isPending}
      />

      <VocabularyDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mode="edit"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleEditWord}
        isLoading={updateVocabularyMutation.isPending}
      />

      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        deletingItem={deletingItem}
        onConfirm={handleDeleteWord}
        isLoading={deleteVocabularyMutation.isPending}
      />
    </div>
  );
}
