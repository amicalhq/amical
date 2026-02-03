"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import type { Model } from "@/db/schema";
import { useTranslation } from "react-i18next";

interface SyncModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: "OpenRouter" | "Ollama";
  modelType?: "language" | "embedding";
}

export default function SyncModelsDialog({
  open,
  onOpenChange,
  provider,
  modelType = "language",
}: SyncModelsDialogProps) {
  const { t } = useTranslation();
  const providerLabel =
    provider === "OpenRouter"
      ? t("settings.aiModels.providers.openRouter")
      : t("settings.aiModels.providers.ollama");
  const modelTypePrefix =
    modelType === "embedding"
      ? `${t("settings.aiModels.modelTypes.embedding")} `
      : "";

  // Local state
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [credentials, setCredentials] = useState<{
    openRouterApiKey?: string;
    ollamaUrl?: string;
  }>({});

  // tRPC queries and mutations
  const utils = api.useUtils();
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();
  const syncedModelsQuery = api.models.getSyncedProviderModels.useQuery();
  const defaultLanguageModelQuery =
    api.models.getDefaultLanguageModel.useQuery();
  const defaultEmbeddingModelQuery =
    api.models.getDefaultEmbeddingModel.useQuery();

  const fetchOpenRouterModelsQuery = api.models.fetchOpenRouterModels.useQuery(
    { apiKey: credentials.openRouterApiKey ?? "" },
    {
      enabled: false, // We'll trigger manually
    },
  );

  const fetchOllamaModelsQuery = api.models.fetchOllamaModels.useQuery(
    { url: credentials.ollamaUrl ?? "" },
    {
      enabled: false, // We'll trigger manually
    },
  );

  const syncProviderModelsMutation =
    api.models.syncProviderModelsToDatabase.useMutation({
      onSuccess: () => {
        // Invalidate all related queries to refresh parent components
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getDefaultLanguageModel.invalidate();
        utils.models.getDefaultEmbeddingModel.invalidate();
        toast.success(t("settings.aiModels.syncDialog.toast.synced"));
      },
      onError: (error: any) => {
        console.error("Failed to sync models to database:", error);
        toast.error(t("settings.aiModels.syncDialog.toast.syncFailed"));
      },
    });

  const setDefaultLanguageModelMutation =
    api.models.setDefaultLanguageModel.useMutation({
      onSuccess: () => {
        utils.models.getDefaultLanguageModel.invalidate();
      },
    });

  const setDefaultEmbeddingModelMutation =
    api.models.setDefaultEmbeddingModel.useMutation({
      onSuccess: () => {
        utils.models.getDefaultEmbeddingModel.invalidate();
      },
    });

  // Extract credentials when provider config is available
  useEffect(() => {
    if (modelProvidersConfigQuery.data) {
      const config = modelProvidersConfigQuery.data;
      setCredentials({
        openRouterApiKey: config.openRouter?.apiKey,
        ollamaUrl: config.ollama?.url,
      });
    }
  }, [modelProvidersConfigQuery.data]);

  // Pre-select already synced models and start fetching when dialog opens
  useEffect(() => {
    if (open && syncedModelsQuery.data) {
      const syncedModelIds = syncedModelsQuery.data
        .filter((m) => m.provider === provider)
        .map((m) => m.id);
      setSelectedModels(syncedModelIds);
      setSearchTerm("");

      // Start fetching models if we have credentials
      if (provider === "OpenRouter" && credentials.openRouterApiKey) {
        fetchOpenRouterModelsQuery.refetch();
      } else if (provider === "Ollama" && credentials.ollamaUrl) {
        fetchOllamaModelsQuery.refetch();
      }
    }
  }, [open, syncedModelsQuery.data, provider, credentials]);

  // Get the appropriate query based on provider
  const activeQuery =
    provider === "OpenRouter"
      ? fetchOpenRouterModelsQuery
      : fetchOllamaModelsQuery;
  const availableModels = activeQuery.data || [];
  const isFetching = activeQuery.isLoading || activeQuery.isFetching;
  const fetchError = activeQuery.error?.message || "";

  // Filter models based on search
  const filteredModels = availableModels.filter(
    (model) =>
      model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      model.id.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Handle model selection
  const toggleModel = (modelId: string, checked: boolean) => {
    if (checked) {
      setSelectedModels((prev) => [...prev, modelId]);
    } else {
      setSelectedModels((prev) => prev.filter((id) => id !== modelId));
    }
  };

  // Handle sync
  const handleSync = async () => {
    const modelsToSync = availableModels.filter((model) =>
      selectedModels.includes(model.id),
    );

    // Sync to database
    await syncProviderModelsMutation.mutateAsync({
      provider,
      models: modelsToSync,
    });

    // Set first model as default if no default is set and this is a language model
    if (modelType === "language" && modelsToSync.length > 0) {
      if (!defaultLanguageModelQuery.data) {
        setDefaultLanguageModelMutation.mutate({ modelId: modelsToSync[0].id });
      }
    } else if (modelType === "embedding" && modelsToSync.length > 0) {
      // For embedding models, only set default if no default is set and this is Ollama provider
      // (embedding models only work with Ollama)
      if (provider === "Ollama" && !defaultEmbeddingModelQuery.data) {
        setDefaultEmbeddingModelMutation.mutate({
          modelId: modelsToSync[0].id,
        });
      }
    }

    handleCancel();
  };

  // Handle cancel
  const handleCancel = () => {
    onOpenChange(false);
    setSelectedModels([]);
    setSearchTerm("");
  };

  // Determine display limits and grid layout
  const displayLimit = provider === "OpenRouter" ? 10 : undefined;
  const gridCols =
    provider === "OpenRouter"
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-1 md:grid-cols-2";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {t("settings.aiModels.syncDialog.title", {
              provider: providerLabel,
              modelType: modelTypePrefix,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("settings.aiModels.syncDialog.description", {
              provider: providerLabel,
              modelType: modelTypePrefix,
            })}
          </DialogDescription>
        </DialogHeader>

        <div
          className={
            provider === "Ollama"
              ? "overflow-y-auto"
              : "max-h-96 overflow-y-auto"
          }
        >
          {isFetching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>
                {t("settings.aiModels.syncDialog.fetching", {
                  available:
                    provider === "Ollama"
                      ? t("settings.aiModels.syncDialog.available")
                      : "",
                })}
              </span>
            </div>
          ) : fetchError ? (
            <div className="text-center py-8">
              <p
                className={
                  provider === "Ollama"
                    ? "text-red-500 mb-2"
                    : "text-destructive"
                }
              >
                {provider === "Ollama"
                  ? t("settings.aiModels.syncDialog.fetchFailed")
                  : t("settings.aiModels.syncDialog.fetchFailedWithMessage", {
                      message: fetchError,
                    })}
              </p>
              {provider === "Ollama" && (
                <p className="text-sm text-muted-foreground">{fetchError}</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Input
                  placeholder={t(
                    "settings.aiModels.syncDialog.searchPlaceholder",
                  )}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-xs"
                />
                <Button variant="outline" onClick={() => setSearchTerm("")}>
                  {t("settings.aiModels.syncDialog.clear")}
                </Button>
              </div>

              <div className={`grid ${gridCols} gap-3`}>
                {(displayLimit
                  ? filteredModels.slice(0, displayLimit)
                  : filteredModels
                ).map((model) => (
                  <div
                    key={model.id}
                    className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() =>
                      toggleModel(model.id, !selectedModels.includes(model.id))
                    }
                  >
                    <Checkbox
                      id={model.id}
                      checked={selectedModels.includes(model.id)}
                      onCheckedChange={(checked) =>
                        toggleModel(model.id, !!checked)
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1"
                    />
                    <div className="grid gap-1.5 leading-none flex-1">
                      <span className="text-sm font-medium leading-none cursor-pointer">
                        {model.name}
                      </span>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        {model.size && (
                          <span>
                            {t("settings.aiModels.syncDialog.size", {
                              size: model.size,
                            })}
                          </span>
                        )}
                        <span>
                          {t("settings.aiModels.syncDialog.context", {
                            context: model.context,
                          })}
                        </span>
                      </div>
                      {/* {model.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {model.description}
                        </p>
                      )} */}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("settings.aiModels.syncDialog.cancel")}
          </Button>
          <Button
            onClick={handleSync}
            disabled={
              selectedModels.length === 0 ||
              syncProviderModelsMutation.isPending
            }
          >
            {syncProviderModelsMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("settings.aiModels.syncDialog.syncing")}
              </>
            ) : (
              t("settings.aiModels.syncDialog.syncButton", {
                count: selectedModels.length,
              })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
