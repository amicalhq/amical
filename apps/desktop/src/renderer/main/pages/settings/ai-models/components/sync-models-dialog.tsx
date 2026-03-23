"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "@/constants/remote-providers";
import {
  getRemoteProviderType,
  getSystemProviderInstanceId,
} from "@/constants/provider-types";
import { getModelSelectionKey } from "@/utils/model-selection";

interface SyncModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: RemoteProvider;
  modelType?: "language" | "embedding";
}

export default function SyncModelsDialog({
  open,
  onOpenChange,
  provider,
  modelType = "language",
}: SyncModelsDialogProps) {
  const { t } = useTranslation();
  const utils = api.useUtils();

  const providerLabel =
    provider === REMOTE_PROVIDERS.openRouter
      ? t("settings.aiModels.providers.openRouter")
      : provider === REMOTE_PROVIDERS.ollama
        ? t("settings.aiModels.providers.ollama")
        : t("settings.aiModels.providers.openAICompatible");
  const modelTypePrefix =
    modelType === "embedding"
      ? `${t("settings.aiModels.modelTypes.embedding")} `
      : "";

  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [credentials, setCredentials] = useState<{
    openRouterApiKey?: string;
    ollamaUrl?: string;
    openAICompatibleApiKey?: string;
    openAICompatibleBaseURL?: string;
  }>({});

  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();
  const syncedModelsQuery = api.models.getSyncedProviderModels.useQuery();
  const defaultLanguageModelQuery =
    api.models.getDefaultLanguageModel.useQuery();
  const defaultEmbeddingModelQuery =
    api.models.getDefaultEmbeddingModel.useQuery();

  const fetchOpenRouterModelsQuery = api.models.fetchOpenRouterModels.useQuery(
    { apiKey: credentials.openRouterApiKey ?? "" },
    { enabled: false },
  );

  const fetchOllamaModelsQuery = api.models.fetchOllamaModels.useQuery(
    { url: credentials.ollamaUrl ?? "" },
    { enabled: false },
  );

  const fetchOpenAICompatibleModelsQuery =
    api.models.fetchOpenAICompatibleModels.useQuery(
      {
        apiKey: credentials.openAICompatibleApiKey ?? "",
        baseURL: credentials.openAICompatibleBaseURL ?? "",
      },
      { enabled: false },
    );

  const syncProviderModelsMutation =
    api.models.syncProviderModelsToDatabase.useMutation({
      onSuccess: () => {
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getDefaultLanguageModel.invalidate();
        utils.models.getDefaultEmbeddingModel.invalidate();
        toast.success(t("settings.aiModels.syncDialog.toast.synced"));
      },
      onError: (error: unknown) => {
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

  useEffect(() => {
    if (!modelProvidersConfigQuery.data) {
      return;
    }

    const config = modelProvidersConfigQuery.data;
    setCredentials({
      openRouterApiKey: config.openRouter?.apiKey,
      ollamaUrl: config.ollama?.url,
      openAICompatibleApiKey: config.openAICompatible?.apiKey,
      openAICompatibleBaseURL: config.openAICompatible?.baseURL,
    });
  }, [modelProvidersConfigQuery.data]);

  useEffect(() => {
    if (!open || !syncedModelsQuery.data) {
      return;
    }

    const syncedModelIds = syncedModelsQuery.data
      .filter((model) => model.providerType === getRemoteProviderType(provider))
      .map((model) => model.id);
    setSelectedModels(syncedModelIds);
    setSearchTerm("");

    if (
      provider === REMOTE_PROVIDERS.openRouter &&
      credentials.openRouterApiKey
    ) {
      fetchOpenRouterModelsQuery.refetch();
      return;
    }

    if (provider === REMOTE_PROVIDERS.ollama && credentials.ollamaUrl) {
      fetchOllamaModelsQuery.refetch();
      return;
    }

    if (
      provider === REMOTE_PROVIDERS.openAICompatible &&
      credentials.openAICompatibleApiKey &&
      credentials.openAICompatibleBaseURL
    ) {
      fetchOpenAICompatibleModelsQuery.refetch();
    }
  }, [open, syncedModelsQuery.data, provider, credentials]);

  const activeQuery =
    provider === REMOTE_PROVIDERS.openRouter
      ? fetchOpenRouterModelsQuery
      : provider === REMOTE_PROVIDERS.ollama
        ? fetchOllamaModelsQuery
        : fetchOpenAICompatibleModelsQuery;

  const availableModels = activeQuery.data || [];
  const isFetching = activeQuery.isLoading || activeQuery.isFetching;
  const fetchError = activeQuery.error?.message || "";

  const filteredModels = availableModels.filter(
    (model) =>
      model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      model.id.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const toggleModel = (modelId: string, checked: boolean) => {
    if (checked) {
      setSelectedModels((prev) => [...prev, modelId]);
    } else {
      setSelectedModels((prev) => prev.filter((id) => id !== modelId));
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    setSelectedModels([]);
    setSearchTerm("");
  };

  const handleSync = async () => {
    const modelsToSync = availableModels.filter((model) =>
      selectedModels.includes(model.id),
    );

    await syncProviderModelsMutation.mutateAsync({
      provider,
      models: modelsToSync,
    });

    if (modelType === "language" && modelsToSync.length > 0) {
      if (!defaultLanguageModelQuery.data) {
        setDefaultLanguageModelMutation.mutate({
          modelId: getModelSelectionKey(
            getSystemProviderInstanceId(getRemoteProviderType(provider)),
            "language",
            modelsToSync[0].id,
          ),
        });
      }
    } else if (
      modelType === "embedding" &&
      modelsToSync.length > 0 &&
      provider === REMOTE_PROVIDERS.ollama
    ) {
      if (!defaultEmbeddingModelQuery.data) {
        setDefaultEmbeddingModelMutation.mutate({
          modelId: getModelSelectionKey(
            getSystemProviderInstanceId(getRemoteProviderType(provider)),
            "embedding",
            modelsToSync[0].id,
          ),
        });
      }
    }

    handleCancel();
  };

  const displayLimit =
    provider === REMOTE_PROVIDERS.openRouter ? 10 : undefined;
  const gridCols =
    provider === REMOTE_PROVIDERS.openRouter
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
            provider === REMOTE_PROVIDERS.ollama
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
                    provider === REMOTE_PROVIDERS.ollama
                      ? t("settings.aiModels.syncDialog.available")
                      : "",
                })}
              </span>
            </div>
          ) : fetchError ? (
            <div className="text-center py-8">
              <p
                className={
                  provider === REMOTE_PROVIDERS.ollama
                    ? "text-red-500 mb-2"
                    : "text-destructive"
                }
              >
                {provider === REMOTE_PROVIDERS.ollama
                  ? t("settings.aiModels.syncDialog.fetchFailed")
                  : t("settings.aiModels.syncDialog.fetchFailedWithMessage", {
                      message: fetchError,
                    })}
              </p>
              {provider === REMOTE_PROVIDERS.ollama && (
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
              isFetching ||
              syncProviderModelsMutation.isPending
            }
          >
            {syncProviderModelsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
