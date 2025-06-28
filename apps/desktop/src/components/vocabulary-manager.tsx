import * as React from "react";
import type { Vocabulary } from "@/db/schema";
import { format } from "date-fns";
import { Plus, Trash2, Edit, Book } from "lucide-react";
import { api } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function VocabularyManager() {
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [newWord, setNewWord] = React.useState({
    word: "",
  });

  // tRPC React Query hooks
  const vocabularyQuery = api.vocabulary.getVocabulary.useQuery({
    limit: 100,
    offset: 0,
    sortBy: "dateAdded",
    sortOrder: "desc",
  });

  const vocabularyCountQuery = api.vocabulary.getVocabularyCount.useQuery({});

  const utils = api.useUtils();

  const createVocabularyMutation =
    api.vocabulary.createVocabularyWord.useMutation({
      onSuccess: () => {
        // Invalidate and refetch vocabulary data
        utils.vocabulary.getVocabulary.invalidate();
        utils.vocabulary.getVocabularyCount.invalidate();
        setNewWord({ word: "" });
        setIsAddDialogOpen(false);
      },
      onError: (error) => {
        console.error("Error adding word:", error);
      },
    });

  const deleteVocabularyMutation = api.vocabulary.deleteVocabulary.useMutation({
    onSuccess: () => {
      // Invalidate and refetch vocabulary data
      utils.vocabulary.getVocabulary.invalidate();
      utils.vocabulary.getVocabularyCount.invalidate();
    },
    onError: (error) => {
      console.error("Error deleting word:", error);
    },
  });

  const handleAddWord = async () => {
    if (newWord.word.trim()) {
      createVocabularyMutation.mutate({
        word: newWord.word.trim().toLowerCase(),
      });
    }
  };

  const handleDeleteWord = async (id: number) => {
    deleteVocabularyMutation.mutate({ id });
  };

  const vocabulary = vocabularyQuery.data || [];
  const totalCount = vocabularyCountQuery.data || 0;
  const loading = vocabularyQuery.isLoading || vocabularyCountQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div></div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="h-10">
              <Plus className="mr-2 h-4 w-4" />
              Add Word
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add Custom Word</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="word">Word</Label>
                <Input
                  id="word"
                  placeholder="Enter the word"
                  value={newWord.word}
                  onChange={(e) =>
                    setNewWord({ ...newWord, word: e.target.value })
                  }
                />
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddWord}
                  disabled={
                    createVocabularyMutation.isPending || !newWord.word.trim()
                  }
                >
                  {createVocabularyMutation.isPending
                    ? "Adding..."
                    : "Add Word"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[300px] font-semibold">Word</TableHead>
              <TableHead className="w-[200px] font-semibold">
                Date Added
              </TableHead>
              <TableHead className="w-[100px] text-right font-semibold">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-12">
                  <div className="flex flex-col items-center space-y-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
                    <p className="text-sm text-muted-foreground">
                      Loading vocabulary...
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : vocabulary.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center py-12 text-muted-foreground"
                >
                  <div className="flex flex-col items-center space-y-2">
                    <Book className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm">No custom vocabulary words yet.</p>
                    <p className="text-xs">
                      Add your first word to get started.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              vocabulary.map((item) => (
                <TableRow key={item.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium py-4">
                    {item.word}
                  </TableCell>
                  <TableCell className="text-muted-foreground py-4 text-sm">
                    {format(new Date(item.dateAdded), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="py-4">
                    <div className="flex justify-end space-x-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Edit word</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteWord(item.id)}
                        disabled={deleteVocabularyMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete word</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && vocabulary.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {vocabulary.length} of {totalCount} word
            {totalCount !== 1 ? "s" : ""}
          </span>
          <span>
            Total: {totalCount} custom word{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
