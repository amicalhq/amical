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

type ProviderName =
  | "OpenRouter"
  | "Ollama"
  | "OpenAI"
  | "Anthropic"
  | "Google";

interface SyncModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderName;
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
  const [credentials, setCredentials] = useState<{
    openRouterApiKey?: string;
    ollamaUrl?: string;
    openAIApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
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
    { enabled: false },
  );

  const fetchOllamaModelsQuery = api.models.fetchOllamaModels.useQuery(
    { url: credentials.ollamaUrl ?? "" },
    { enabled: false },
  );

  const fetchOpenAIModelsQuery = api.models.fetchOpenAIModels.useQuery(
    { apiKey: credentials.openAIApiKey ?? "" },
    { enabled: false },
  );

  const fetchAnthropicModelsQuery = api.models.fetchAnthropicModels.useQuery(
    { apiKey: credentials.anthropicApiKey ?? "" },
    { enabled: false },
  );

  const fetchGoogleModelsQuery = api.models.fetchGoogleModels.useQuery(
    { apiKey: credentials.googleApiKey ?? "" },
    { enabled: false },
  );

  const syncProviderModelsMutation =
    api.models.syncProviderModelsToDatabase.useMutation({
      onSuccess: () => {
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getDefaultLanguageModel.invalidate();
        utils.models.getDefaultEmbeddingModel.invalidate();
        toast.success("Models synced to database successfully!");
      },
      onError: (error: any) => {
        console.error("Failed to sync models to database:", error);
        toast.error("Failed to sync models to database. Please try again.");
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
        openAIApiKey: config.openAI?.apiKey,
        anthropicApiKey: config.anthropic?.apiKey,
        googleApiKey: config.google?.apiKey,
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
      switch (provider) {
        case "OpenRouter":
          if (credentials.openRouterApiKey)
            fetchOpenRouterModelsQuery.refetch();
          break;
        case "Ollama":
          if (credentials.ollamaUrl) fetchOllamaModelsQuery.refetch();
          break;
        case "OpenAI":
          if (credentials.openAIApiKey) fetchOpenAIModelsQuery.refetch();
          break;
        case "Anthropic":
          if (credentials.anthropicApiKey)
            fetchAnthropicModelsQuery.refetch();
          break;
        case "Google":
          if (credentials.googleApiKey) fetchGoogleModelsQuery.refetch();
          break;
      }
    }
  }, [open, syncedModelsQuery.data, provider, credentials]);

  // Get the appropriate query based on provider
  const getActiveQuery = () => {
    switch (provider) {
      case "OpenRouter":
        return fetchOpenRouterModelsQuery;
      case "Ollama":
        return fetchOllamaModelsQuery;
      case "OpenAI":
        return fetchOpenAIModelsQuery;
      case "Anthropic":
        return fetchAnthropicModelsQuery;
      case "Google":
        return fetchGoogleModelsQuery;
    }
  };

  const activeQuery = getActiveQuery();
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

    // Set first model as default if no default is set
    if (modelType === "language" && modelsToSync.length > 0) {
      if (!defaultLanguageModelQuery.data) {
        setDefaultLanguageModelMutation.mutate({ modelId: modelsToSync[0].id });
      }
    } else if (modelType === "embedding" && modelsToSync.length > 0) {
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
      <DialogContent className="min-w-4xl max-h-screen flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            Select {provider} {modelType === "embedding" ? "Embedding " : ""}
            Models
          </DialogTitle>
          <DialogDescription>
            Choose which {modelType === "embedding" ? "embedding " : ""}models
            you want to sync from {provider}.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isFetching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Fetching models...</span>
            </div>
          ) : fetchError ? (
            <div className="text-center py-8">
              <p className="text-destructive">
                Failed to fetch models: {fetchError}
              </p>
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
                        {model.size && <span>Size: {model.size}</span>}
                        <span>Context: {model.context}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0">
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
