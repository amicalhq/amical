"use client";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import ChangeDefaultModelDialog from "./change-default-model-dialog";
import type { ProviderModel } from "@/types/providers";

interface DefaultModelComboboxProps {
  modelType: "language" | "embedding";
  title?: string;
}

export default function DefaultModelCombobox({
  modelType,
  title = "Default Model",
}: DefaultModelComboboxProps) {
  // Local state
  const [syncedModels, setSyncedModels] = useState<ProviderModel[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [changeDefaultDialogOpen, setChangeDefaultDialogOpen] = useState(false);
  const [newDefaultModel, setNewDefaultModel] = useState<string>("");

  // tRPC queries and mutations
  const utils = api.useUtils();
  const syncedModelsQuery = api.settings.getSyncedProviderModels.useQuery();
  const defaultLanguageModelQuery =
    api.settings.getDefaultLanguageModel.useQuery();
  const defaultEmbeddingModelQuery =
    api.settings.getDefaultEmbeddingModel.useQuery();

  const setDefaultLanguageModelMutation =
    api.settings.setDefaultLanguageModel.useMutation({
      onSuccess: () => {
        utils.settings.getDefaultLanguageModel.invalidate();
        toast.success("Default language model updated!");
      },
      onError: (error) => {
        console.error("Failed to set default language model:", error);
        toast.error("Failed to set default language model. Please try again.");
      },
    });

  const setDefaultEmbeddingModelMutation =
    api.settings.setDefaultEmbeddingModel.useMutation({
      onSuccess: () => {
        utils.settings.getDefaultEmbeddingModel.invalidate();
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
      setSyncedModels(syncedModelsQuery.data);
    }
  }, [syncedModelsQuery.data]);

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

  const selectedModel = syncedModels.find((m) => m.id === newDefaultModel);

  return (
    <>
      <div>
        <Label className="text-lg font-semibold">{title}</Label>
        <div className="mt-2 max-w-xs">
          <Combobox
            options={syncedModels.map((m) => ({
              value: m.id,
              label: m.name,
            }))}
            value={defaultModel}
            onChange={(value) => {
              // Guard against empty value from Combobox clear action
              if (value && value !== defaultModel) {
                openChangeDefaultDialog(value);
              }
            }}
            placeholder="Select a model..."
          />
        </div>
      </div>

      <ChangeDefaultModelDialog
        open={changeDefaultDialogOpen}
        onOpenChange={setChangeDefaultDialogOpen}
        selectedModel={selectedModel}
        onConfirm={confirmChangeDefault}
        modelType={modelType}
      />
    </>
  );
}
