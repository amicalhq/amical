"use client";
import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import ChangeDefaultModelDialog from "./change-default-model-dialog";

interface DefaultModelComboboxProps {
  modelType: "speech" | "language" | "embedding";
  title?: string;
}

export default function DefaultModelCombobox({
  modelType,
  title = "Default Model",
}: DefaultModelComboboxProps) {
  // State for embedding confirmation dialog
  const [changeDefaultDialogOpen, setChangeDefaultDialogOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string>("");

  // tRPC queries and mutations
  const utils = api.useUtils();

  // Unified queries
  const modelsQuery = api.models.getModels.useQuery({
    type: modelType,
    selectable: true, // Only show models that can be selected (authenticated cloud or downloaded local)
  });

  const defaultModelQuery = api.models.getDefaultModel.useQuery({
    type: modelType,
  });

  // Subscribe to model selection changes
  api.models.onSelectionChanged.useSubscription(undefined, {
    onData: ({ modelType: changedType }) => {
      // Only invalidate if the change is for our model type
      if (changedType === modelType) {
        utils.models.getDefaultModel.invalidate({ type: modelType });
        utils.models.getModels.invalidate({ type: modelType });
      }
    },
    onError: (error) => {
      console.error("Selection changed subscription error:", error);
    },
  });

  api.models.onDownloadComplete.useSubscription(undefined, {
    onData: () => {
      utils.models.getModels.invalidate({ type: modelType });
    },
    onError: (error) => {
      console.error("Selection changed subscription error:", error);
    },
  });

  api.models.onModelDeleted.useSubscription(undefined, {
    onData: () => {
      utils.models.getModels.invalidate({ type: modelType });
    },
    onError: (error) => {
      console.error("Selection changed subscription error:", error);
    },
  });

  // Unified mutation
  const setDefaultModelMutation = api.models.setDefaultModel.useMutation({
    onSuccess: () => {
      utils.models.getDefaultModel.invalidate({ type: modelType });
      toast.success(`Default ${modelType} model updated!`);
    },
    onError: (error) => {
      console.error(`Failed to set default ${modelType} model:`, error);
      toast.error(
        `Failed to set default ${modelType} model. Please try again.`,
      );
    },
  });

  // Transform models for display
  const modelOptions = useMemo(() => {
    if (!modelsQuery.data) return [];

    if (modelType === "speech") {
      // Speech models from local whisper
      return modelsQuery.data.map((m) => ({
        value: m.id,
        label: m.name,
      }));
    } else {
      // Provider models for language/embedding
      return modelsQuery.data.map((m) => ({
        value: m.id,
        label: m.name,
      }));
    }
  }, [modelsQuery.data, modelType]);

  const handleModelChange = (modelId: string) => {
    if (!modelId || modelId === defaultModelQuery.data) return;

    // Only show confirmation dialog for embedding models
    if (modelType === "embedding") {
      setPendingModelId(modelId);
      setChangeDefaultDialogOpen(true);
    } else {
      // For speech and language models, update immediately
      setDefaultModelMutation.mutate({ type: modelType, modelId });
    }
  };

  const confirmChangeDefault = () => {
    if (pendingModelId) {
      setDefaultModelMutation.mutate({
        type: modelType,
        modelId: pendingModelId,
      });
      setPendingModelId("");
    }
  };

  // Find the selected model for the dialog
  const selectedModel = useMemo(() => {
    if (!pendingModelId || !modelsQuery.data) return undefined;
    return modelsQuery.data.find((m) => m.id === pendingModelId);
  }, [pendingModelId, modelsQuery.data]);

  // Loading state
  if (modelsQuery.isLoading || defaultModelQuery.isLoading) {
    return (
      <div>
        <Label className="text-lg font-semibold">{title}</Label>
        <div className="mt-2 max-w-xs">
          <Combobox
            options={[]}
            value=""
            onChange={() => {}}
            placeholder="Loading..."
            disabled
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <Label className="text-lg font-semibold">{title}</Label>
        <div className="mt-2 max-w-xs">
          <Combobox
            options={modelOptions}
            value={defaultModelQuery.data || ""}
            onChange={handleModelChange}
            placeholder="Select a model..."
          />
        </div>
      </div>

      {modelType === "embedding" && (
        <ChangeDefaultModelDialog
          open={changeDefaultDialogOpen}
          onOpenChange={(open) => {
            setChangeDefaultDialogOpen(open);
            if (!open) setPendingModelId("");
          }}
          selectedModel={selectedModel}
          onConfirm={confirmChangeDefault}
          modelType="embedding"
        />
      )}
    </>
  );
}
