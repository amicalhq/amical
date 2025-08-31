"use client";
import { useState, useEffect } from "react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Import ProviderModel type
import type { ProviderModel } from "@/types/providers";

export default function LanguageTab() {
  const [syncedModels, setSyncedModels] = useState<ProviderModel[]>([]);
  const [availableOpenRouterModels, setAvailableOpenRouterModels] = useState<
    ProviderModel[]
  >([]);
  const [availableOllamaModels, setAvailableOllamaModels] = useState<
    ProviderModel[]
  >([]);
  const [defaultLanguageModel, setDefaultLanguageModel] = useState("");

  // Provider connection states
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterStatus, setOpenrouterStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");

  // tRPC queries and mutations
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();
  const syncedModelsQuery = api.settings.getSyncedProviderModels.useQuery();
  const defaultLanguageModelQuery =
    api.settings.getDefaultLanguageModel.useQuery();
  const utils = api.useUtils();

  const setOpenRouterConfigMutation =
    api.settings.setOpenRouterConfig.useMutation({
      onSuccess: () => {
        toast.success("OpenRouter configuration saved successfully!");
        utils.settings.getModelProvidersConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save OpenRouter config:", error);
        toast.error(
          "Failed to save OpenRouter configuration. Please try again."
        );
      },
    });

  const setOllamaConfigMutation = api.settings.setOllamaConfig.useMutation({
    onSuccess: () => {
      toast.success("Ollama configuration saved successfully!");
      utils.settings.getModelProvidersConfig.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save Ollama config:", error);
      toast.error("Failed to save Ollama configuration. Please try again.");
    },
  });

  // Validation mutations
  const validateOpenRouterMutation =
    api.settings.validateOpenRouterConnection.useMutation({
      onSuccess: (result) => {
        setIsValidatingOpenRouter(false);
        if (result.success) {
          // Save the API key after successful validation
          setOpenRouterConfigMutation.mutate({ apiKey: openrouterKey.trim() });
          setOpenrouterStatus("connected");
          setOpenRouterValidationError("");
          toast.success("OpenRouter connection validated successfully!");
        } else {
          setOpenRouterValidationError(result.error || "Validation failed");
          toast.error(`OpenRouter validation failed: ${result.error}`);
        }
      },
      onError: (error) => {
        setIsValidatingOpenRouter(false);
        setOpenRouterValidationError(error.message);
        toast.error(`OpenRouter validation error: ${error.message}`);
      },
    });

  const validateOllamaMutation =
    api.settings.validateOllamaConnection.useMutation({
      onSuccess: (result) => {
        setIsValidatingOllama(false);
        if (result.success) {
          // Save the URL after successful validation
          setOllamaConfigMutation.mutate({ url: ollamaUrl.trim() });
          setOllamaStatus("connected");
          setOllamaValidationError("");
          toast.success("Ollama connection validated successfully!");
        } else {
          setOllamaValidationError(result.error || "Validation failed");
          toast.error(`Ollama validation failed: ${result.error}`);
        }
      },
      onError: (error) => {
        setIsValidatingOllama(false);
        setOllamaValidationError(error.message);
        toast.error(`Ollama validation error: ${error.message}`);
      },
    });

  // Database sync mutations
  const syncProviderModelsMutation =
    api.settings.syncProviderModels.useMutation({
      onSuccess: () => {
        utils.settings.getSyncedProviderModels.invalidate();
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
        toast.success("Default language model updated!");
      },
      onError: (error) => {
        console.error("Failed to set default language model:", error);
        toast.error("Failed to set default language model. Please try again.");
      },
    });

  const removeProviderModelMutation =
    api.settings.removeProviderModel.useMutation({
      onSuccess: () => {
        utils.settings.getSyncedProviderModels.invalidate();
        toast.success("Model removed successfully!");
      },
      onError: (error) => {
        console.error("Failed to remove model:", error);
        toast.error("Failed to remove model. Please try again.");
      },
    });

  const removeOpenRouterProviderMutation =
    api.settings.removeOpenRouterProvider.useMutation({
      onSuccess: () => {
        utils.settings.getModelProvidersConfig.invalidate();
        utils.settings.getSyncedProviderModels.invalidate();
        utils.settings.getDefaultLanguageModel.invalidate();
        setOpenrouterStatus("disconnected");
        setOpenrouterKey("");
        toast.success("OpenRouter provider removed successfully!");
      },
      onError: (error) => {
        console.error("Failed to remove OpenRouter provider:", error);
        toast.error("Failed to remove OpenRouter provider. Please try again.");
      },
    });

  const removeOllamaProviderMutation =
    api.settings.removeOllamaProvider.useMutation({
      onSuccess: () => {
        utils.settings.getModelProvidersConfig.invalidate();
        utils.settings.getSyncedProviderModels.invalidate();
        utils.settings.getDefaultLanguageModel.invalidate();
        setOllamaStatus("disconnected");
        // setOllamaUrl("http://localhost:11434");
        toast.success("Ollama provider removed successfully!");
      },
      onError: (error) => {
        console.error("Failed to remove Ollama provider:", error);
        toast.error("Failed to remove Ollama provider. Please try again.");
      },
    });

  // Model fetching queries
  const fetchOpenRouterModelsQuery =
    api.settings.fetchOpenRouterModels.useQuery(
      { apiKey: openrouterKey },
      { enabled: false } // Don't auto-fetch
    );

  const fetchOllamaModelsQuery = api.settings.fetchOllamaModels.useQuery(
    { url: ollamaUrl },
    { enabled: false } // Don't auto-fetch
  );

  // Handle OpenRouter models fetch result
  useEffect(() => {
    if (fetchOpenRouterModelsQuery.data) {
      setAvailableOpenRouterModels(fetchOpenRouterModelsQuery.data);
      setOpenRouterFetchError("");
      setIsFetchingOpenRouterModels(false);
    }
    if (fetchOpenRouterModelsQuery.error) {
      setOpenRouterFetchError(fetchOpenRouterModelsQuery.error.message);
      setIsFetchingOpenRouterModels(false);
      toast.error(
        `Failed to fetch OpenRouter models: ${fetchOpenRouterModelsQuery.error.message}`
      );
    }
  }, [fetchOpenRouterModelsQuery.data, fetchOpenRouterModelsQuery.error]);

  // Handle Ollama models fetch result
  useEffect(() => {
    if (fetchOllamaModelsQuery.data) {
      setAvailableOllamaModels(fetchOllamaModelsQuery.data);
      setOllamaFetchError("");
      setIsFetchingOllamaModels(false);
    }
    if (fetchOllamaModelsQuery.error) {
      setOllamaFetchError(fetchOllamaModelsQuery.error.message);
      setIsFetchingOllamaModels(false);
      toast.error(
        `Failed to fetch Ollama models: ${fetchOllamaModelsQuery.error.message}`
      );
    }
  }, [fetchOllamaModelsQuery.data, fetchOllamaModelsQuery.error]);

  // Load synced models from database
  useEffect(() => {
    if (syncedModelsQuery.data) {
      setSyncedModels(syncedModelsQuery.data);
    }
  }, [syncedModelsQuery.data]);

  // Load default language model from database
  useEffect(() => {
    if (defaultLanguageModelQuery.data !== undefined) {
      setDefaultLanguageModel(defaultLanguageModelQuery.data || "");
    }
  }, [defaultLanguageModelQuery.data]);

  // Dialog states
  const [openrouterDialogOpen, setOpenrouterDialogOpen] = useState(false);
  const [ollamaDialogOpen, setOllamaDialogOpen] = useState(false);
  const [selectedOpenRouterModels, setSelectedOpenRouterModels] = useState<
    string[]
  >([]);
  const [selectedOllamaModels, setSelectedOllamaModels] = useState<string[]>(
    []
  );
  const [openrouterSearch, setOpenrouterSearch] = useState("");
  const [ollamaSearch, setOllamaSearch] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string>("");
  const [removeProviderDialogOpen, setRemoveProviderDialogOpen] =
    useState(false);
  const [providerToRemove, setProviderToRemove] = useState<string>("");
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [changeDefaultDialogOpen, setChangeDefaultDialogOpen] = useState(false);
  const [newDefaultModel, setNewDefaultModel] = useState<string>("");

  // Validation states
  const [isValidatingOpenRouter, setIsValidatingOpenRouter] = useState(false);
  const [isValidatingOllama, setIsValidatingOllama] = useState(false);
  const [openRouterValidationError, setOpenRouterValidationError] =
    useState<string>("");
  const [ollamaValidationError, setOllamaValidationError] =
    useState<string>("");

  // Model fetching states
  const [isFetchingOpenRouterModels, setIsFetchingOpenRouterModels] =
    useState(false);
  const [isFetchingOllamaModels, setIsFetchingOllamaModels] = useState(false);
  const [openRouterFetchError, setOpenRouterFetchError] = useState<string>("");
  const [ollamaFetchError, setOllamaFetchError] = useState<string>("");

  // Load configuration when query data is available
  useEffect(() => {
    if (modelProvidersConfigQuery.data) {
      const config = modelProvidersConfigQuery.data;
      console.log("config", config);

      // Load OpenRouter config
      if (config.openRouter?.apiKey) {
        setOpenrouterKey(config.openRouter.apiKey);
        setOpenrouterStatus("connected");
      } else {
        setOpenrouterKey("");
        setOpenrouterStatus("disconnected");
      }

      // Load Ollama config
      if (config.ollama?.url && config.ollama.url !== "") {
        console.log("config.ollama.url", config.ollama.url);
        setOllamaUrl(config.ollama.url);
        setOllamaStatus("connected");
      } else {
        // setOllamaUrl("http://localhost:11434");
        setOllamaStatus("disconnected");
      }
    }
  }, [modelProvidersConfigQuery.data]);

  // Connect functions with validation
  const handleOpenRouterConnect = () => {
    if (!openrouterKey.trim()) return;

    setIsValidatingOpenRouter(true);
    setOpenRouterValidationError("");

    // Validate before saving
    validateOpenRouterMutation.mutate({ apiKey: openrouterKey.trim() });
  };

  const handleOllamaConnect = () => {
    if (!ollamaUrl.trim()) return;

    setIsValidatingOllama(true);
    setOllamaValidationError("");

    // Validate before saving
    validateOllamaMutation.mutate({ url: ollamaUrl.trim() });
  };

  // Open dialog with pre-selected synced models and fetch available models
  const openOpenRouterDialog = () => {
    const syncedOpenRouterModels = syncedModels
      .filter((m) => m.provider === "OpenRouter")
      .map((m) => m.id);
    setSelectedOpenRouterModels(syncedOpenRouterModels);
    setOpenrouterSearch("");
    setOpenrouterDialogOpen(true);

    // Fetch available models
    if (openrouterKey.trim()) {
      setIsFetchingOpenRouterModels(true);
      setOpenRouterFetchError("");
      fetchOpenRouterModelsQuery.refetch();
    }
  };

  const openOllamaDialog = () => {
    const syncedOllamaModels = syncedModels
      .filter((m) => m.provider === "Ollama")
      .map((m) => m.id);
    setSelectedOllamaModels(syncedOllamaModels);
    setOllamaSearch("");
    setOllamaDialogOpen(true);

    // Fetch available models
    if (ollamaUrl.trim()) {
      setIsFetchingOllamaModels(true);
      setOllamaFetchError("");
      fetchOllamaModelsQuery.refetch();
    }
  };

  // Sync models functions
  const handleOpenRouterSync = () => {
    const selectedModels = availableOpenRouterModels.filter((model) =>
      selectedOpenRouterModels.includes(model.id)
    );

    // Sync to database
    syncProviderModelsMutation.mutate({
      provider: "OpenRouter",
      models: selectedModels,
    });

    // Set first model as default if no default is set
    if (!defaultLanguageModel && selectedModels.length > 0) {
      setDefaultLanguageModelMutation.mutate({ modelId: selectedModels[0].id });
    }

    setOpenrouterDialogOpen(false);
    setSelectedOpenRouterModels([]);
  };

  const handleOllamaSync = () => {
    const selectedModels = availableOllamaModels.filter((model) =>
      selectedOllamaModels.includes(model.id)
    );

    // Sync to database
    syncProviderModelsMutation.mutate({
      provider: "Ollama",
      models: selectedModels,
    });

    // Set first model as default if no default is set
    if (!defaultLanguageModel && selectedModels.length > 0) {
      setDefaultLanguageModelMutation.mutate({ modelId: selectedModels[0].id });
    }

    setOllamaDialogOpen(false);
    setSelectedOllamaModels([]);
  };

  const handleRemoveModel = (modelId: string) => {
    // Remove from database
    removeProviderModelMutation.mutate({ modelId });

    // Clear default if removing the default model
    if (defaultLanguageModel === modelId) {
      setDefaultLanguageModelMutation.mutate({ modelId: undefined });
    }
  };

  // Delete confirmation functions
  const openDeleteDialog = (modelId: string) => {
    // Check if trying to remove the default model
    if (modelId === defaultLanguageModel) {
      setErrorMessage(
        "Please select another model as default before removing this model."
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

  // Remove provider functions
  const openRemoveProviderDialog = (provider: string) => {
    setProviderToRemove(provider);
    setRemoveProviderDialogOpen(true);
  };

  const confirmRemoveProvider = () => {
    if (providerToRemove === "OpenRouter") {
      removeOpenRouterProviderMutation.mutate();
    } else if (providerToRemove === "Ollama") {
      removeOllamaProviderMutation.mutate();
    }
    setRemoveProviderDialogOpen(false);
    setProviderToRemove("");
  };

  const cancelRemoveProvider = () => {
    setRemoveProviderDialogOpen(false);
    setProviderToRemove("");
  };

  // Change default model functions
  const openChangeDefaultDialog = (modelId: string) => {
    setNewDefaultModel(modelId);
    setChangeDefaultDialogOpen(true);
  };

  const confirmChangeDefault = () => {
    // Update default model in database
    setDefaultLanguageModelMutation.mutate({ modelId: newDefaultModel });
    setChangeDefaultDialogOpen(false);
    setNewDefaultModel("");
  };

  const cancelChangeDefault = () => {
    setChangeDefaultDialogOpen(false);
    setNewDefaultModel("");
  };

  // Filter functions
  const filteredOpenRouterModels = availableOpenRouterModels.filter(
    (model) =>
      model.name.toLowerCase().includes(openrouterSearch.toLowerCase()) ||
      model.id.toLowerCase().includes(openrouterSearch.toLowerCase())
  );

  const filteredOllamaModels = availableOllamaModels.filter(
    (model) =>
      model.name.toLowerCase().includes(ollamaSearch.toLowerCase()) ||
      model.id.toLowerCase().includes(ollamaSearch.toLowerCase())
  );

  function statusIndicator(status: "connected" | "disconnected") {
    return (
      <Badge
        variant="secondary"
        className={cn(
          "text-xs flex items-center gap-1",
          status === "connected"
            ? "text-green-500 border-green-500"
            : "text-red-500 border-red-500"
        )}
      >
        <span
          className={cn(
            "w-2 h-2 rounded-full inline-block animate-pulse mr-1",
            status === "connected" ? "bg-green-500" : "bg-red-500"
          )}
        />
        {status === "connected" ? "Connected" : "Disconnected"}
      </Badge>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Default model picker */}
        <div>
          <Label className="text-lg font-semibold">
            Default Language Model
          </Label>
          <div className="mt-2 max-w-xs">
            <Combobox
              options={syncedModels.map((m) => ({
                value: m.id,
                label: m.name,
              }))}
              value={defaultLanguageModel}
              onChange={(value) => {
                if (value !== defaultLanguageModel) {
                  openChangeDefaultDialog(value);
                }
              }}
              placeholder="Select a model..."
            />
          </div>
        </div>

        {/* Providers Accordions */}
        <Accordion type="multiple" className="w-full">
          {/* OpenRouter */}
          <AccordionItem value="openrouter">
            <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
              <div className="flex w-full items-center justify-between">
                <span className="hover:underline">OpenRouter</span>
                {statusIndicator(openrouterStatus)}
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-1">
              <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
                <Input
                  type="password"
                  placeholder="API Key"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  className="max-w-xs"
                  disabled={openrouterStatus === "connected"}
                />
                {openrouterStatus === "disconnected" ? (
                  <Button
                    variant="outline"
                    onClick={handleOpenRouterConnect}
                    disabled={!openrouterKey.trim() || isValidatingOpenRouter}
                  >
                    {isValidatingOpenRouter ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={openOpenRouterDialog}>
                      Sync models
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openRemoveProviderDialog("OpenRouter")}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove Provider
                    </Button>
                  </div>
                )}
              </div>
              {openRouterValidationError && (
                <p className="text-xs text-destructive mt-2">
                  {openRouterValidationError}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Ollama */}
          <AccordionItem value="ollama">
            <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
              <div className="flex w-full items-center justify-between">
                <span className="hover:underline">Ollama</span>
                {statusIndicator(ollamaStatus)}
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-1">
              <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
                <Input
                  type="text"
                  placeholder="Ollama URL (e.g., http://localhost:11434)"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  className="max-w-xs"
                  disabled={ollamaStatus === "connected"}
                />
                {ollamaStatus === "disconnected" ? (
                  <Button
                    variant="outline"
                    onClick={handleOllamaConnect}
                    disabled={!ollamaUrl.trim() || isValidatingOllama}
                  >
                    {isValidatingOllama ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={openOllamaDialog}>
                      Sync models
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openRemoveProviderDialog("Ollama")}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove Provider
                    </Button>
                  </div>
                )}
              </div>
              {ollamaValidationError && (
                <p className="text-xs text-destructive mt-2">
                  {ollamaValidationError}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Model Table */}
        <div>
          <Label className="text-lg font-semibold mb-2 block">
            Synced Models
          </Label>
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
                      <TableCell className="font-medium">
                        {model.name}
                      </TableCell>
                      <TableCell>{model.provider}</TableCell>
                      <TableCell>{model.size}</TableCell>
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
                                      defaultLanguageModel === model.id
                                        ? "text-green-500"
                                        : "text-muted-foreground"
                                    )}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  {defaultLanguageModel === model.id
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

        {/* OpenRouter Model Selection Dialog */}
        <Dialog
          open={openrouterDialogOpen}
          onOpenChange={setOpenrouterDialogOpen}
        >
          <DialogContent className="min-w-4xl">
            <DialogHeader>
              <DialogTitle>Select OpenRouter Models</DialogTitle>
              <DialogDescription>
                Choose which models you want to sync from OpenRouter.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <Input
                  placeholder="Search models..."
                  value={openrouterSearch}
                  onChange={(e) => setOpenrouterSearch(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  variant="outline"
                  onClick={() => setOpenrouterSearch("")}
                >
                  Clear
                </Button>
              </div>
              {isFetchingOpenRouterModels ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Fetching models...</span>
                </div>
              ) : openRouterFetchError ? (
                <div className="text-center p-8 text-destructive">
                  <p>Failed to fetch models: {openRouterFetchError}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredOpenRouterModels.slice(0, 10).map((model) => (
                    <div
                      key={model.id}
                      className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                    >
                      <Checkbox
                        id={model.id}
                        checked={selectedOpenRouterModels.includes(model.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOpenRouterModels((prev) => [
                              ...prev,
                              model.id,
                            ]);
                          } else {
                            setSelectedOpenRouterModels((prev) =>
                              prev.filter((v) => v !== model.id)
                            );
                          }
                        }}
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOpenrouterDialogOpen(false);
                  setSelectedOpenRouterModels([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleOpenRouterSync}
                disabled={selectedOpenRouterModels.length === 0}
              >
                Sync {selectedOpenRouterModels.length} model
                {selectedOpenRouterModels.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Ollama Model Selection Dialog */}
        <Dialog open={ollamaDialogOpen} onOpenChange={setOllamaDialogOpen}>
          <DialogContent className="min-w-4xl">
            <DialogHeader>
              <DialogTitle>Select Ollama Models</DialogTitle>
              <DialogDescription>
                Choose which models you want to sync from Ollama.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <Input
                  placeholder="Search models..."
                  value={ollamaSearch}
                  onChange={(e) => setOllamaSearch(e.target.value)}
                  className="max-w-xs"
                />
                <Button variant="outline" onClick={() => setOllamaSearch("")}>
                  Clear
                </Button>
              </div>
              {isFetchingOllamaModels ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Fetching models...</span>
                </div>
              ) : ollamaFetchError ? (
                <div className="text-center p-8 text-destructive">
                  <p>Failed to fetch models: {ollamaFetchError}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredOllamaModels.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                    >
                      <Checkbox
                        id={model.id}
                        checked={selectedOllamaModels.includes(model.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOllamaModels((prev) => [
                              ...prev,
                              model.id,
                            ]);
                          } else {
                            setSelectedOllamaModels((prev) =>
                              prev.filter((v) => v !== model.id)
                            );
                          }
                        }}
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOllamaDialogOpen(false);
                  setSelectedOllamaModels([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleOllamaSync}
                disabled={selectedOllamaModels.length === 0}
              >
                Sync {selectedOllamaModels.length} model
                {selectedOllamaModels.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        {/* Remove Provider Confirmation Dialog */}
        <Dialog
          open={removeProviderDialogOpen}
          onOpenChange={setRemoveProviderDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove Provider Connection</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove your {providerToRemove}{" "}
                connection? This will disconnect your account and remove all
                synced models from this provider. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelRemoveProvider}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmRemoveProvider}>
                Remove Provider
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        {/* Change Default Model Dialog */}
        <Dialog
          open={changeDefaultDialogOpen}
          onOpenChange={setChangeDefaultDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Default Model</DialogTitle>
              <DialogDescription>
                Are you sure you want to set "
                {syncedModels.find((m) => m.id === newDefaultModel)?.name}" as
                your default language model?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelChangeDefault}>
                Cancel
              </Button>
              <Button onClick={confirmChangeDefault}>Change Default</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
