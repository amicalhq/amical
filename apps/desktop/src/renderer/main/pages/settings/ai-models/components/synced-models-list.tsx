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
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import ChangeDefaultModelDialog from "./change-default-model-dialog";
import type { Model } from "@/db/schema";

interface SyncedModelsListProps {
  modelType: "language" | "embedding";
  title?: string;
}

export default function SyncedModelsList({
  modelType,
  title = "Synced Models",
}: SyncedModelsListProps) {
  // Local state
  const [syncedModels, setSyncedModels] = useState<Model[]>([]);
  const [defaultModel, setDefaultModel] = useState("");

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string>("");
  const [changeDefaultDialogOpen, setChangeDefaultDialogOpen] = useState(false);
  const [newDefaultModel, setNewDefaultModel] = useState<string>("");
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // tRPC queries and mutations
  const utils = api.useUtils();
  const syncedModelsQuery = api.models.getSyncedProviderModels.useQuery();
  const defaultLanguageModelQuery =
    api.models.getDefaultLanguageModel.useQuery();
  const defaultEmbeddingModelQuery =
    api.models.getDefaultEmbeddingModel.useQuery();

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

  const setDefaultLanguageModelMutation =
    api.models.setDefaultLanguageModel.useMutation({
      onSuccess: () => {
        utils.models.getDefaultLanguageModel.invalidate();
        toast.success("Default language model updated!");
      },
      onError: (error) => {
        console.error("Failed to set default language model:", error);
        toast.error("Failed to set default language model. Please try again.");
      },
    });

  const setDefaultEmbeddingModelMutation =
    api.models.setDefaultEmbeddingModel.useMutation({
      onSuccess: () => {
        utils.models.getDefaultEmbeddingModel.invalidate();
        toast.success("Default embedding model updated!");
      },
      onError: (error) => {
        console.error("Failed to set default embedding model:", error);
        toast.error("Failed to set default embedding model. Please try again.");
      },
    });

  // Load synced models
  useEffect(() => {
    if (syncedModelsQuery.data) {
      let filteredModels = syncedModelsQuery.data;

      // For embedding models, only show Ollama models
      if (modelType === "embedding") {
        filteredModels = syncedModelsQuery.data.filter(
          (model) => model.provider.toLowerCase() === "ollama",
        );
      }

      setSyncedModels(filteredModels);
    }
  }, [syncedModelsQuery.data, modelType]);

  // Load default model based on type
  useEffect(() => {
    if (
      modelType === "language" &&
      defaultLanguageModelQuery.data !== undefined
    ) {
      setDefaultModel(defaultLanguageModelQuery.data || "");
    } else if (
      modelType === "embedding" &&
      defaultEmbeddingModelQuery.data !== undefined
    ) {
      setDefaultModel(defaultEmbeddingModelQuery.data || "");
    }
  }, [
    modelType,
    defaultLanguageModelQuery.data,
    defaultEmbeddingModelQuery.data,
  ]);

  // Delete confirmation functions
  const openDeleteDialog = (modelId: string) => {
    // Check if trying to remove the default model
    if (modelId === defaultModel) {
      setErrorMessage(
        "Please select another model as default before removing this model.",
      );
      setErrorDialogOpen(true);
      return;
    }
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

  // Change default model functions
  const openChangeDefaultDialog = (modelId: string) => {
    setNewDefaultModel(modelId);
    setChangeDefaultDialogOpen(true);
  };

  const confirmChangeDefault = () => {
    if (modelType === "language") {
      setDefaultLanguageModelMutation.mutate({ modelId: newDefaultModel });
    } else {
      setDefaultEmbeddingModelMutation.mutate({ modelId: newDefaultModel });
    }
    setNewDefaultModel("");
  };

  const handleRemoveModel = (modelId: string) => {
    removeProviderModelMutation.mutate({ modelId });

    // Clear default if removing the default model
    if (defaultModel === modelId) {
      if (modelType === "language") {
        setDefaultLanguageModelMutation.mutate({ modelId: null });
      } else {
        setDefaultEmbeddingModelMutation.mutate({ modelId: null });
      }
    }
  };

  return (
    <>
      {/* Model Table */}
      <div>
        <Label className="text-lg font-semibold mb-2 block">{title}</Label>
        {syncedModels.length === 0 ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <p>No models synced yet.</p>
            <p className="text-sm mt-1">
              Connect to a provider and sync models to see them here.
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
                      <div className="flex gap-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  openChangeDefaultDialog(model.id)
                                }
                              >
                                <Check
                                  className={cn(
                                    "w-4 h-4",
                                    defaultModel === model.id
                                      ? "text-green-500"
                                      : "text-muted-foreground",
                                  )}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {defaultModel === model.id
                                  ? "Current default model"
                                  : "Set as default model"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
                      </div>
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

      <ChangeDefaultModelDialog
        open={changeDefaultDialogOpen}
        onOpenChange={setChangeDefaultDialogOpen}
        selectedModel={syncedModels.find((m) => m.id === newDefaultModel)}
        onConfirm={confirmChangeDefault}
        modelType={modelType}
      />

      {/* Error Dialog */}
      <Dialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cannot Remove Model</DialogTitle>
            <DialogDescription>{errorMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setErrorDialogOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
