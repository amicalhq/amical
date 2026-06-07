"use client";
import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import ChangeDefaultModelDialog from "./change-default-model-dialog";
import { useTranslation } from "react-i18next";
import {
  findModelBySelectionValue,
  getModelSelectionKey,
} from "@/utils/model-selection";
import { useLocalTranscriptionSupported } from "@/hooks/useLocalTranscriptionSupported";

interface DefaultModelComboboxProps {
  modelType: "speech" | "language" | "embedding";
  title?: string;
}

export default function DefaultModelCombobox({
  modelType,
  title,
}: DefaultModelComboboxProps) {
  const { t } = useTranslation();
  const modelTypeLabel = t(`settings.aiModels.modelTypes.${modelType}`);
  const resolvedTitle = title ?? t("settings.aiModels.defaultModels.default");

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

  // Local (on-device) speech models require macOS 15+. Only relevant for the
  // speech picker, so the check is skipped for language/embedding.
  const { localSupported, isLoading: localSupportedLoading } =
    useLocalTranscriptionSupported({ enabled: modelType === "speech" });

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
      toast.success(
        t("settings.aiModels.defaultModel.toast.updated", {
          modelType: modelTypeLabel,
        }),
      );
    },
    onError: (error) => {
      console.error(`Failed to set default ${modelType} model:`, error);
      toast.error(
        t("settings.aiModels.defaultModel.toast.updateFailed", {
          modelType: modelTypeLabel,
        }),
      );
    },
  });

  // Transform models for display
  const modelOptions = useMemo(() => {
    if (!modelsQuery.data) return [];

    if (modelType === "speech") {
      // Speech models: cloud (Amical Cloud) + local whisper. Local requires
      // macOS 15+, so disable local entries when unsupported.
      return modelsQuery.data.map((m) => {
        const isLocal = m.provider !== "Amical Cloud";
        const disabled = isLocal && !localSupported;
        return {
          value: m.id,
          label: m.name,
          disabled,
          disabledReason: disabled
            ? t("settings.aiModels.speech.localUnsupported")
            : undefined,
        };
      });
    } else {
      // Provider models for language/embedding
      return modelsQuery.data.map((m) => ({
        value: getModelSelectionKey(m.providerInstanceId, m.type, m.id),
        label: m.name,
      }));
    }
  }, [modelsQuery.data, modelType, localSupported, t]);

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
    if (modelType === "speech") {
      return modelsQuery.data.find((m) => m.id === pendingModelId);
    }

    return findModelBySelectionValue(modelsQuery.data, pendingModelId);
  }, [modelType, pendingModelId, modelsQuery.data]);

  // Loading state
  if (
    modelsQuery.isLoading ||
    defaultModelQuery.isLoading ||
    localSupportedLoading
  ) {
    return (
      <div>
        <Label className="text-lg font-semibold">{resolvedTitle}</Label>
        <div className="mt-2 max-w-xs">
          <Combobox
            options={[]}
            value=""
            onChange={() => {}}
            placeholder={t("settings.aiModels.defaultModel.loading")}
            disabled
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <Label className="text-lg font-semibold">{resolvedTitle}</Label>
        <div className="mt-2 max-w-xs">
          <Combobox
            options={modelOptions}
            value={defaultModelQuery.data || ""}
            onChange={handleModelChange}
            placeholder={t("settings.aiModels.defaultModel.placeholder")}
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
