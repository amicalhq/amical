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

type VocabularyItem = {
  id: string;
  word: string;
  replacement?: string;
  isReplacement: boolean;
};

// Mock data for vocabulary items
const mockVocabularyItems: VocabularyItem[] = [
  {
    id: "1",
    word: "kate",
    replacement: "cate",
    isReplacement: true,
  },
  {
    id: "2",
    word: "Krishna",
    isReplacement: false,
  },
  {
    id: "3",
    word: "nikets40@gmail.com",
    isReplacement: false,
  },
  {
    id: "4",
    word: "Niket Singh",
    isReplacement: false,
  },
];

// Add/Edit Dialog Component
interface VocabularyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  formData: {
    word: string;
    replacement: string;
    isReplacement: boolean;
  };
  onFormDataChange: (data: {
    word: string;
    replacement: string;
    isReplacement: boolean;
  }) => void;
  onSubmit: () => void;
}

function VocabularyDialog({
  open,
  onOpenChange,
  mode,
  formData,
  onFormDataChange,
  onSubmit,
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
                  value={formData.replacement}
                  onChange={(e) =>
                    onFormDataChange({
                      ...formData,
                      replacement: e.target.value,
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
            <Button onClick={onSubmit}>
              {mode === "add" ? "Add word" : "Save changes"}
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
}

function DeleteDialog({
  open,
  onOpenChange,
  deletingItem,
  onConfirm,
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
              ? `${deletingItem?.word} → ${deletingItem?.replacement}`
              : deletingItem?.word}
            "? This action cannot be undone.
          </p>
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VocabularySettingsPage() {
  const [vocabularyItems, setVocabularyItems] =
    useState<VocabularyItem[]>(mockVocabularyItems);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VocabularyItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<VocabularyItem | null>(null);
  const [formData, setFormData] = useState({
    word: "",
    replacement: "",
    isReplacement: false,
  });

  const handleAddWord = () => {
    const newItem: VocabularyItem = {
      id: Date.now().toString(),
      word: formData.word,
      replacement: formData.isReplacement ? formData.replacement : undefined,
      isReplacement: formData.isReplacement,
    };
    setVocabularyItems([...vocabularyItems, newItem]);
    setFormData({ word: "", replacement: "", isReplacement: false });
    setIsAddDialogOpen(false);
  };

  const handleEditWord = () => {
    if (!editingItem) return;

    const updatedItems = vocabularyItems.map((item) =>
      item.id === editingItem.id
        ? {
            ...item,
            word: formData.word,
            replacement: formData.isReplacement
              ? formData.replacement
              : undefined,
            isReplacement: formData.isReplacement,
          }
        : item
    );
    setVocabularyItems(updatedItems);
    setFormData({ word: "", replacement: "", isReplacement: false });
    setEditingItem(null);
    setIsEditDialogOpen(false);
  };

  const handleDeleteWord = () => {
    if (!deletingItem) return;

    const updatedItems = vocabularyItems.filter(
      (item) => item.id !== deletingItem.id
    );
    setVocabularyItems(updatedItems);
    setDeletingItem(null);
    setIsDeleteDialogOpen(false);
  };

  const openEditDialog = (item: VocabularyItem) => {
    setEditingItem(item);
    setFormData({
      word: item.word,
      replacement: item.replacement || "",
      isReplacement: item.isReplacement,
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (item: VocabularyItem) => {
    setDeletingItem(item);
    setIsDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ word: "", replacement: "", isReplacement: false });
    setEditingItem(null);
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold">Vocabulary</h1>
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
                        <span>{item.replacement}</span>
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
      />

      <VocabularyDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mode="edit"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleEditWord}
      />

      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        deletingItem={deletingItem}
        onConfirm={handleDeleteWord}
      />
    </div>
  );
}
