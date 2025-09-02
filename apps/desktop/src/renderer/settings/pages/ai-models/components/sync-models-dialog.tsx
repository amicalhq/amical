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
import type { ProviderModel } from "@/types/providers";

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
  // Local state
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [credentials, setCredentials] = useState<{
    openRouterApiKey?: string;
    ollamaUrl?: string;
  }>({});

  // tRPC queries and mutations
  const utils = api.useUtils();
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();
  const syncedModelsQuery = api.settings.getSyncedProviderModels.useQuery();
  const defaultLanguageModelQuery =
    api.settings.getDefaultLanguageModel.useQuery();

  const fetchOpenRouterModelsQuery =
    api.settings.fetchOpenRouterModels.useQuery(
      { apiKey: credentials.openRouterApiKey || "" },
      { enabled: false },
    );

  const fetchOllamaModelsQuery = api.settings.fetchOllamaModels.useQuery(
    { url: credentials.ollamaUrl || "" },
    { enabled: false },
  );

  const syncProviderModelsMutation =
    api.settings.syncProviderModels.useMutation({
      onSuccess: () => {
        // Invalidate all related queries to refresh parent components
        utils.settings.getSyncedProviderModels.invalidate();
        utils.settings.getDefaultLanguageModel.invalidate();
        utils.settings.getDefaultEmbeddingModel.invalidate();
        toast.success("Models synced to database successfully!");
      },
      onError: (error) => {
        console.error("Failed to sync models to database:", error);
        toast.error("Failed to sync models to database. Please try again.");
      },
    });

  const setDefaultLanguageModelMutation =
    api.settings.setDefaultLanguageModel.useMutation({
      onSuccess: () => {
        utils.settings.getDefaultLanguageModel.invalidate();
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
        setIsFetching(true);
        setFetchError("");
        fetchOpenRouterModelsQuery.refetch();
      } else if (provider === "Ollama" && credentials.ollamaUrl) {
        setIsFetching(true);
        setFetchError("");
        fetchOllamaModelsQuery.refetch();
      }
    }
  }, [open, syncedModelsQuery.data, provider, credentials]);

  // Handle OpenRouter fetch results
  useEffect(() => {
    if (fetchOpenRouterModelsQuery.data && provider === "OpenRouter") {
      setAvailableModels(fetchOpenRouterModelsQuery.data);
      setFetchError("");
      setIsFetching(false);
    }
  }, [fetchOpenRouterModelsQuery.data, provider]);

  useEffect(() => {
    if (fetchOpenRouterModelsQuery.error && provider === "OpenRouter") {
      setFetchError(fetchOpenRouterModelsQuery.error.message);
      setIsFetching(false);
      toast.error(
        `Failed to fetch OpenRouter models: ${fetchOpenRouterModelsQuery.error.message}`,
      );
    }
  }, [fetchOpenRouterModelsQuery.error, provider]);

  // Handle Ollama fetch results
  useEffect(() => {
    if (fetchOllamaModelsQuery.data && provider === "Ollama") {
      setAvailableModels(fetchOllamaModelsQuery.data);
      setFetchError("");
      setIsFetching(false);
    }
  }, [fetchOllamaModelsQuery.data, provider]);

  useEffect(() => {
    if (fetchOllamaModelsQuery.error && provider === "Ollama") {
      setFetchError(fetchOllamaModelsQuery.error.message);
      setIsFetching(false);
      toast.error(
        `Failed to fetch Ollama models: ${fetchOllamaModelsQuery.error.message}`,
      );
    }
  }, [fetchOllamaModelsQuery.error, provider]);

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
  const handleSync = () => {
    const modelsToSync = availableModels.filter((model) =>
      selectedModels.includes(model.id),
    );

    // Sync to database
    syncProviderModelsMutation.mutate({
      provider,
      models: modelsToSync,
    });

    // Set first model as default if no default is set and this is a language model
    if (modelType === "language" && modelsToSync.length > 0) {
      if (!defaultLanguageModelQuery.data) {
        setDefaultLanguageModelMutation.mutate({ modelId: modelsToSync[0].id });
      }
    } else if (modelType === "embedding" && modelsToSync.length > 0) {
      // For embedding models, we'd need to check the default embedding model
      // This would require fetching the default embedding model query
      // For now, we'll skip auto-setting default for embedding models
    }

    handleCancel();
  };

  // Handle cancel
  const handleCancel = () => {
    onOpenChange(false);
    setSelectedModels([]);
    setSearchTerm("");
    setAvailableModels([]);
    setFetchError("");
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
            Select {provider} {modelType === "embedding" ? "Embedding " : ""}
            Models
          </DialogTitle>
          <DialogDescription>
            Choose which {modelType === "embedding" ? "embedding " : ""}models
            you want to sync from {provider}.
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
                Fetching {provider === "Ollama" ? "available " : ""}models...
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
                Failed to fetch models
                {provider === "Ollama" ? "" : `: ${fetchError}`}
              </p>
              {provider === "Ollama" && (
                <p className="text-sm text-muted-foreground">{fetchError}</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Input
                  placeholder="Search models..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-xs"
                />
                <Button variant="outline" onClick={() => setSearchTerm("")}>
                  Clear
                </Button>
              </div>

              <div className={`grid ${gridCols} gap-3`}>
                {(displayLimit
                  ? filteredModels.slice(0, displayLimit)
                  : filteredModels
                ).map((model) => (
                  <div
                    key={model.id}
                    className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <Checkbox
                      id={model.id}
                      checked={selectedModels.includes(model.id)}
                      onCheckedChange={(checked) =>
                        toggleModel(model.id, !!checked)
                      }
                      className="mt-1"
                    />
                    <div className="grid gap-1.5 leading-none flex-1">
                      <label
                        htmlFor={model.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {model.name}
                      </label>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        {model.size && <span>Size: {model.size}</span>}
                        <span>Context: {model.context}</span>
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
            Cancel
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
                Syncing...
              </>
            ) : (
              `Sync ${selectedModels.length} model${selectedModels.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
