"use client";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import type { Model } from "@/db/schema";

interface SyncedModelsListProps {
  title?: string;
}

export default function SyncedModelsList({
  title = "Available Models",
}: SyncedModelsListProps) {
  // Local state
  const [syncedModels, setSyncedModels] = useState<Model[]>([]);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string>("");

  // tRPC queries and mutations
  const utils = api.useUtils();
  const syncedModelsQuery = api.models.getSyncedProviderModels.useQuery();
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();

  const removeProviderModelMutation =
    api.models.removeProviderModel.useMutation({
      onSuccess: () => {
        utils.models.getSyncedProviderModels.invalidate();
        toast.success("Model removed successfully!");
      },
      onError: (error) => {
        console.error("Failed to remove model:", error);
        toast.error("Failed to remove model. Please try again.");
      },
    });

  // Load synced models
  useEffect(() => {
    if (syncedModelsQuery.data) {
      const config = modelProvidersConfigQuery.data;
      const registeredProviders = new Set<string>();

      if (config?.openRouter?.apiKey) registeredProviders.add("OpenRouter");
      if (config?.ollama?.url) registeredProviders.add("Ollama");
      if (config?.openAI?.apiKey) registeredProviders.add("OpenAI");
      if (config?.anthropic?.apiKey) registeredProviders.add("Anthropic");
      if (config?.google?.apiKey) registeredProviders.add("Google");

      const languageModels = syncedModelsQuery.data.filter(
        (model) => model.type === "language",
      );

      if (registeredProviders.size === 0) {
        setSyncedModels([]);
        return;
      }

      const filteredModels = languageModels.filter((model) =>
        registeredProviders.has(model.provider),
      );

      setSyncedModels(filteredModels);
    }
  }, [
    syncedModelsQuery.data,
    modelProvidersConfigQuery.data,
  ]);

  // Delete confirmation functions
  const openDeleteDialog = (modelId: string) => {
    setModelToDelete(modelId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (modelToDelete) {
      handleRemoveModel(modelToDelete);
      setDeleteDialogOpen(false);
      setModelToDelete("");
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setModelToDelete("");
  };

  const handleRemoveModel = (modelId: string) => {
    removeProviderModelMutation.mutate({ modelId });
  };

  return (
    <>
      {/* Model Table */}
      <div>
        <Label className="text-lg font-semibold mb-2 block">{title}</Label>
        {syncedModels.length === 0 ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <p>No models available yet.</p>
            <p className="text-sm mt-1">
              Connect providers in the Models section and sync to see available
              models here.
            </p>
          </div>
        ) : (
          <div className="divide-y border rounded-md bg-muted/30">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Context</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncedModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">{model.name}</TableCell>
                    <TableCell>{model.provider}</TableCell>
                    <TableCell>{model.size || "Unknown"}</TableCell>
                    <TableCell>{model.context}</TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openDeleteDialog(model.id)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Remove model</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "
              {syncedModels.find((m) => m.id === modelToDelete)?.name}" from
              your synced models? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Remove Model
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
