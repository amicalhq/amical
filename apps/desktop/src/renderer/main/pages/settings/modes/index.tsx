import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { ModeCard } from "./components/ModeCard";

export default function ModesPage() {
  const modesQuery = api.settings.getModes.useQuery();
  const utils = api.useUtils();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newModeName, setNewModeName] = useState("");
  const [expandedModeId, setExpandedModeId] = useState<string | null>(null);

  const createModeMutation = api.settings.createMode.useMutation({
    onSuccess: (newMode) => {
      utils.settings.getModes.invalidate();
      setCreateDialogOpen(false);
      setNewModeName("");
      setExpandedModeId(newMode.id);
      toast.success(`Mode "${newMode.name}" created`);
    },
    onError: (error) => {
      console.error("Failed to create mode:", error);
      toast.error(error.message || "Failed to create mode");
    },
  });

  const handleCreateMode = useCallback(() => {
    const name = newModeName.trim();
    if (!name) return;

    createModeMutation.mutate({
      name,
      dictation: {
        autoDetectEnabled: true,
        selectedLanguage: "en",
      },
      formatterConfig: {
        enabled: false,
      },
    });
  }, [newModeName, createModeMutation]);

  const modes = modesQuery.data?.items ?? [];
  const activeModeId = modesQuery.data?.activeModeId ?? "default";

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Modes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Create and manage transcription modes with different language,
            formatting, and instruction settings.
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Create mode
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create new mode</DialogTitle>
              <DialogDescription>
                Create a new transcription mode with custom settings.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="mode-name" className="mb-2 block">
                Mode name
              </Label>
              <Input
                id="mode-name"
                value={newModeName}
                onChange={(e) => setNewModeName(e.target.value)}
                placeholder="e.g. Casual, Meeting Notes, Technical"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newModeName.trim()) {
                    handleCreateMode();
                  }
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateMode}
                disabled={
                  !newModeName.trim() || createModeMutation.isPending
                }
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {modes.map((mode) => (
          <ModeCard
            key={mode.id}
            mode={mode}
            isActive={mode.id === activeModeId}
            isExpanded={expandedModeId === mode.id}
            onToggleExpand={() =>
              setExpandedModeId(
                expandedModeId === mode.id ? null : mode.id,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
