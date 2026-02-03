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
import { useTranslation } from "react-i18next";

interface SyncedModelsListProps {
  modelType: "language" | "embedding";
  title?: string;
}

export default function SyncedModelsList({
  modelType,
  title,
}: SyncedModelsListProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("settings.aiModels.syncedModels.title");

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
        toast.success(t("settings.aiModels.syncedModels.toast.removed"));
      },
      onError: (error) => {
        console.error("Failed to remove model:", error);
        toast.error(t("settings.aiModels.syncedModels.toast.removeFailed"));
      },
    });

  const setDefaultLanguageModelMutation =
    api.models.setDefaultLanguageModel.useMutation({
      onSuccess: () => {
        utils.models.getDefaultLanguageModel.invalidate();
        toast.success(
          t("settings.aiModels.syncedModels.toast.defaultLanguageUpdated"),
        );
      },
      onError: (error) => {
        console.error("Failed to set default language model:", error);
        toast.error(
          t("settings.aiModels.syncedModels.toast.defaultLanguageFailed"),
        );
      },
    });

  const setDefaultEmbeddingModelMutation =
    api.models.setDefaultEmbeddingModel.useMutation({
      onSuccess: () => {
        utils.models.getDefaultEmbeddingModel.invalidate();
        toast.success(
          t("settings.aiModels.syncedModels.toast.defaultEmbeddingUpdated"),
        );
      },
      onError: (error) => {
        console.error("Failed to set default embedding model:", error);
        toast.error(
          t("settings.aiModels.syncedModels.toast.defaultEmbeddingFailed"),
        );
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
      setErrorMessage(t("settings.aiModels.syncedModels.errorDefaultRemove"));
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
        <Label className="text-lg font-semibold mb-2 block">
          {resolvedTitle}
        </Label>
        {syncedModels.length === 0 ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <p>{t("settings.aiModels.syncedModels.empty.title")}</p>
            <p className="text-sm mt-1">
              {t("settings.aiModels.syncedModels.empty.description")}
            </p>
          </div>
        ) : (
          <div className="divide-y border rounded-md bg-muted/30">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("settings.aiModels.syncedModels.table.name")}
                  </TableHead>
                  <TableHead>
                    {t("settings.aiModels.syncedModels.table.provider")}
                  </TableHead>
                  <TableHead>
                    {t("settings.aiModels.syncedModels.table.size")}
                  </TableHead>
                  <TableHead>
                    {t("settings.aiModels.syncedModels.table.context")}
                  </TableHead>
                  <TableHead>
                    {t("settings.aiModels.syncedModels.table.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncedModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">{model.name}</TableCell>
                    <TableCell>{model.provider}</TableCell>
                    <TableCell>
                      {model.size ||
                        t("settings.aiModels.syncedModels.table.unknown")}
                    </TableCell>
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
                                  ? t(
                                      "settings.aiModels.syncedModels.table.currentDefault",
                                    )
                                  : t(
                                      "settings.aiModels.syncedModels.table.setDefault",
                                    )}
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
                              <p>
                                {t(
                                  "settings.aiModels.syncedModels.table.remove",
                                )}
                              </p>
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
            <DialogTitle>
              {t("settings.aiModels.syncedModels.deleteDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.aiModels.syncedModels.deleteDialog.description", {
                modelName:
                  syncedModels.find((m) => m.id === modelToDelete)?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>
              {t("settings.aiModels.syncedModels.deleteDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {t("settings.aiModels.syncedModels.deleteDialog.confirm")}
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
            <DialogTitle>
              {t("settings.aiModels.syncedModels.errorDialog.title")}
            </DialogTitle>
            <DialogDescription>{errorMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setErrorDialogOpen(false)}>
              {t("settings.aiModels.syncedModels.errorDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
