import * as React from "react"
import { Plus, Trash2, Edit, Book } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Mock data for vocabulary words
const mockVocabulary = [
  {
    id: 1,
    word: "Amical",
    dateAdded: "2024-01-15",
  },
  {
    id: 2,
    word: "API",
    dateAdded: "2024-01-10",
  },
  {
    id: 3,
    word: "TypeScript",
    dateAdded: "2024-01-08",
  },
  {
    id: 4,
    word: "Electron",
    dateAdded: "2024-01-05",
  },
  {
    id: 5,
    word: "macOS",
    dateAdded: "2024-01-03",
  },
]

export function VocabularyManager() {
  const [vocabulary, setVocabulary] = React.useState(mockVocabulary)
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  const [newWord, setNewWord] = React.useState({
    word: "",
  })

  const handleAddWord = () => {
    if (newWord.word.trim()) {
      const newVocabItem = {
        id: Date.now(),
        ...newWord,
        dateAdded: new Date().toISOString().split('T')[0],
      }
      setVocabulary([newVocabItem, ...vocabulary])
      setNewWord({ word: "" })
      setIsAddDialogOpen(false)
    }
  }

  const handleDeleteWord = (id: number) => {
    setVocabulary(vocabulary.filter(item => item.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Custom Vocabulary</h2>
          <p className="text-muted-foreground mt-1">
            Manage words that transcription should recognize accurately
          </p>
        </div>
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
                  onChange={(e) => setNewWord({ ...newWord, word: e.target.value })}
                />
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddWord}>Add Word</Button>
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
              <TableHead className="w-[200px] font-semibold">Date Added</TableHead>
              <TableHead className="w-[100px] text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vocabulary.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center space-y-2">
                    <Book className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm">No custom vocabulary words yet.</p>
                    <p className="text-xs">Add your first word to get started.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              vocabulary.map((item) => (
                <TableRow key={item.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium py-4">{item.word}</TableCell>
                  <TableCell className="text-muted-foreground py-4 text-sm">{item.dateAdded}</TableCell>
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

      {vocabulary.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {vocabulary.length} of {vocabulary.length} word{vocabulary.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total: {vocabulary.length} custom word{vocabulary.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
} 