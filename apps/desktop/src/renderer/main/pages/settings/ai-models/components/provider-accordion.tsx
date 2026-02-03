"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import SyncModelsDialog from "./sync-models-dialog";

type ProviderName =
  | "OpenRouter"
  | "Ollama"
  | "OpenAI"
  | "Anthropic"
  | "Google"
  | "Groq"
  | "Grok";

interface ProviderAccordionProps {
  provider: ProviderName;
  modelType: "language" | "embedding" | "transcription";
}

export default function ProviderAccordion({
  provider,
  modelType,
}: ProviderAccordionProps) {
  // Local state
  const [status, setStatus] = useState<"connected" | "disconnected">(
    "disconnected",
  );
  const [inputValue, setInputValue] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [removeProviderDialogOpen, setRemoveProviderDialogOpen] =
    useState(false);

  const isTranscriptionMode = modelType === "transcription";

  // tRPC queries and mutations
  const utils = api.useUtils();
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery(undefined, {
      enabled: !isTranscriptionMode,
    });
  const transcriptionProvidersConfigQuery =
    api.settings.getTranscriptionProvidersConfig.useQuery(undefined, {
      enabled: isTranscriptionMode,
    });

  // --- Config save mutations ---
  const setOpenRouterConfigMutation =
    api.settings.setOpenRouterConfig.useMutation({
      onSuccess: () => {
        toast.success("OpenRouter configuration saved successfully!");
        utils.settings.getModelProvidersConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save OpenRouter config:", error);
        toast.error(
          "Failed to save OpenRouter configuration. Please try again.",
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

  const setOpenAIConfigMutation = api.settings.setOpenAIConfig.useMutation({
    onSuccess: () => {
      toast.success("OpenAI configuration saved successfully!");
      utils.settings.getModelProvidersConfig.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save OpenAI config:", error);
      toast.error("Failed to save OpenAI configuration. Please try again.");
    },
  });

  const setAnthropicConfigMutation =
    api.settings.setAnthropicConfig.useMutation({
      onSuccess: () => {
        toast.success("Anthropic configuration saved successfully!");
        utils.settings.getModelProvidersConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save Anthropic config:", error);
        toast.error(
          "Failed to save Anthropic configuration. Please try again.",
        );
      },
    });

  const setGoogleConfigMutation = api.settings.setGoogleConfig.useMutation({
    onSuccess: () => {
      toast.success("Google configuration saved successfully!");
      utils.settings.getModelProvidersConfig.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save Google config:", error);
      toast.error("Failed to save Google configuration. Please try again.");
    },
  });

  // --- Transcription config save mutations ---
  const setTranscriptionOpenAIConfigMutation =
    api.settings.setTranscriptionOpenAIConfig.useMutation({
      onSuccess: () => {
        toast.success("OpenAI transcription configuration saved!");
        utils.settings.getTranscriptionProvidersConfig.invalidate();
        utils.models.getTranscriptionProviderStatus.invalidate();
        utils.models.getModels.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save transcription OpenAI config:", error);
        toast.error("Failed to save configuration.");
      },
    });

  const setTranscriptionGroqConfigMutation =
    api.settings.setTranscriptionGroqConfig.useMutation({
      onSuccess: () => {
        toast.success("Groq transcription configuration saved!");
        utils.settings.getTranscriptionProvidersConfig.invalidate();
        utils.models.getTranscriptionProviderStatus.invalidate();
        utils.models.getModels.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save transcription Groq config:", error);
        toast.error("Failed to save configuration.");
      },
    });

  const setTranscriptionGrokConfigMutation =
    api.settings.setTranscriptionGrokConfig.useMutation({
      onSuccess: () => {
        toast.success("Grok transcription configuration saved!");
        utils.settings.getTranscriptionProvidersConfig.invalidate();
        utils.models.getTranscriptionProviderStatus.invalidate();
        utils.models.getModels.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save transcription Grok config:", error);
        toast.error("Failed to save configuration.");
      },
    });

  // --- Transcription validation mutations ---
  const validateTranscriptionOpenAIMutation =
    api.models.validateTranscriptionOpenAIConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "OpenAI", () =>
          setTranscriptionOpenAIConfigMutation.mutate({
            apiKey: inputValue.trim(),
          }),
        ),
      onError: (error) => onValidationError(error, "OpenAI"),
    });

  const validateTranscriptionGroqMutation =
    api.models.validateTranscriptionGroqConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Groq", () =>
          setTranscriptionGroqConfigMutation.mutate({
            apiKey: inputValue.trim(),
          }),
        ),
      onError: (error) => onValidationError(error, "Groq"),
    });

  const validateTranscriptionGrokMutation =
    api.models.validateTranscriptionGrokConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Grok", () =>
          setTranscriptionGrokConfigMutation.mutate({
            apiKey: inputValue.trim(),
          }),
        ),
      onError: (error) => onValidationError(error, "Grok"),
    });

  // --- Transcription remove provider mutations ---
  const removeTranscriptionOpenAIProviderMutation =
    api.models.removeTranscriptionOpenAIProvider.useMutation({
      onSuccess: () => {
        utils.settings.getTranscriptionProvidersConfig.invalidate();
        utils.models.getTranscriptionProviderStatus.invalidate();
        utils.models.getSelectedModel.invalidate();
        utils.models.getModels.invalidate();
        setStatus("disconnected");
        setInputValue("");
        toast.success("OpenAI transcription provider removed!");
      },
      onError: (error) => onRemoveError(error, "OpenAI"),
    });

  const removeTranscriptionGroqProviderMutation =
    api.models.removeTranscriptionGroqProvider.useMutation({
      onSuccess: () => {
        utils.settings.getTranscriptionProvidersConfig.invalidate();
        utils.models.getTranscriptionProviderStatus.invalidate();
        utils.models.getSelectedModel.invalidate();
        utils.models.getModels.invalidate();
        setStatus("disconnected");
        setInputValue("");
        toast.success("Groq transcription provider removed!");
      },
      onError: (error) => onRemoveError(error, "Groq"),
    });

  const removeTranscriptionGrokProviderMutation =
    api.models.removeTranscriptionGrokProvider.useMutation({
      onSuccess: () => {
        utils.settings.getTranscriptionProvidersConfig.invalidate();
        utils.models.getTranscriptionProviderStatus.invalidate();
        utils.models.getSelectedModel.invalidate();
        utils.models.getModels.invalidate();
        setStatus("disconnected");
        setInputValue("");
        toast.success("Grok transcription provider removed!");
      },
      onError: (error) => onRemoveError(error, "Grok"),
    });

  // --- Validation mutations ---
  const onValidationSuccess = (
    result: { success: boolean; error?: string },
    providerName: ProviderName,
    saveConfig: () => void,
  ) => {
    setIsValidating(false);
    if (result.success) {
      saveConfig();
      setValidationError("");
      toast.success(`${providerName} connection validated successfully!`);
    } else {
      setValidationError(result.error || "Validation failed");
      toast.error(`${providerName} validation failed: ${result.error}`);
    }
  };

  const onValidationError = (error: { message: string }, providerName: ProviderName) => {
    setIsValidating(false);
    setValidationError(error.message);
    toast.error(`${providerName} validation error: ${error.message}`);
  };

  const validateOpenRouterMutation =
    api.models.validateOpenRouterConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "OpenRouter", () =>
          setOpenRouterConfigMutation.mutate({ apiKey: inputValue.trim() }),
        ),
      onError: (error) => onValidationError(error, "OpenRouter"),
    });

  const validateOllamaMutation =
    api.models.validateOllamaConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Ollama", () =>
          setOllamaConfigMutation.mutate({ url: inputValue.trim() }),
        ),
      onError: (error) => onValidationError(error, "Ollama"),
    });

  const validateOpenAIMutation =
    api.models.validateOpenAIConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "OpenAI", () =>
          setOpenAIConfigMutation.mutate({ apiKey: inputValue.trim() }),
        ),
      onError: (error) => onValidationError(error, "OpenAI"),
    });

  const validateAnthropicMutation =
    api.models.validateAnthropicConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Anthropic", () =>
          setAnthropicConfigMutation.mutate({ apiKey: inputValue.trim() }),
        ),
      onError: (error) => onValidationError(error, "Anthropic"),
    });

  const validateGoogleMutation =
    api.models.validateGoogleConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Google", () =>
          setGoogleConfigMutation.mutate({ apiKey: inputValue.trim() }),
        ),
      onError: (error) => onValidationError(error, "Google"),
    });

  // --- Remove provider mutations ---
  const onRemoveSuccess = (providerName: ProviderName) => {
    utils.settings.getModelProvidersConfig.invalidate();
    utils.models.getSyncedProviderModels.invalidate();
    utils.models.getDefaultLanguageModel.invalidate();
    utils.models.getDefaultEmbeddingModel.invalidate();
    setStatus("disconnected");
    setInputValue("");
    toast.success(`${providerName} provider removed successfully!`);
  };

  const onRemoveError = (error: unknown, providerName: ProviderName) => {
    console.error(`Failed to remove ${providerName} provider:`, error);
    toast.error(`Failed to remove ${providerName} provider. Please try again.`);
  };

  const removeOpenRouterProviderMutation =
    api.models.removeOpenRouterProvider.useMutation({
      onSuccess: () => onRemoveSuccess("OpenRouter"),
      onError: (error) => onRemoveError(error, "OpenRouter"),
    });

  const removeOllamaProviderMutation =
    api.models.removeOllamaProvider.useMutation({
      onSuccess: () => onRemoveSuccess("Ollama"),
      onError: (error) => onRemoveError(error, "Ollama"),
    });

  const removeOpenAIProviderMutation =
    api.models.removeOpenAIProvider.useMutation({
      onSuccess: () => onRemoveSuccess("OpenAI"),
      onError: (error) => onRemoveError(error, "OpenAI"),
    });

  const removeAnthropicProviderMutation =
    api.models.removeAnthropicProvider.useMutation({
      onSuccess: () => onRemoveSuccess("Anthropic"),
      onError: (error) => onRemoveError(error, "Anthropic"),
    });

  const removeGoogleProviderMutation =
    api.models.removeGoogleProvider.useMutation({
      onSuccess: () => onRemoveSuccess("Google"),
      onError: (error) => onRemoveError(error, "Google"),
    });

  // Load configuration when query data is available
  useEffect(() => {
    if (isTranscriptionMode && transcriptionProvidersConfigQuery.data) {
      const config = transcriptionProvidersConfigQuery.data;
      let credential: string | undefined;

      switch (provider) {
        case "OpenAI":
          credential = config.openAI?.apiKey;
          break;
        case "Groq":
          credential = config.groq?.apiKey;
          break;
        case "Grok":
          credential = config.grok?.apiKey;
          break;
      }

      if (credential) {
        setInputValue(credential);
        setStatus("connected");
      } else {
        setInputValue("");
        setStatus("disconnected");
      }
    } else if (!isTranscriptionMode && modelProvidersConfigQuery.data) {
      const config = modelProvidersConfigQuery.data;
      let credential: string | undefined;

      switch (provider) {
        case "OpenRouter":
          credential = config.openRouter?.apiKey;
          break;
        case "Ollama":
          credential = config.ollama?.url && config.ollama.url !== "" ? config.ollama.url : undefined;
          break;
        case "OpenAI":
          credential = config.openAI?.apiKey;
          break;
        case "Anthropic":
          credential = config.anthropic?.apiKey;
          break;
        case "Google":
          credential = config.google?.apiKey;
          break;
      }

      if (credential) {
        setInputValue(credential);
        setStatus("connected");
      } else {
        setInputValue("");
        setStatus("disconnected");
      }
    }
  }, [modelProvidersConfigQuery.data, transcriptionProvidersConfigQuery.data, provider, isTranscriptionMode]);

  // Connect functions with validation
  const handleConnect = () => {
    if (!inputValue.trim()) return;

    setIsValidating(true);
    setValidationError("");

    if (isTranscriptionMode) {
      switch (provider) {
        case "OpenAI":
          validateTranscriptionOpenAIMutation.mutate({
            apiKey: inputValue.trim(),
          });
          break;
        case "Groq":
          validateTranscriptionGroqMutation.mutate({
            apiKey: inputValue.trim(),
          });
          break;
        case "Grok":
          validateTranscriptionGrokMutation.mutate({
            apiKey: inputValue.trim(),
          });
          break;
      }
    } else {
      switch (provider) {
        case "OpenRouter":
          validateOpenRouterMutation.mutate({ apiKey: inputValue.trim() });
          break;
        case "Ollama":
          validateOllamaMutation.mutate({ url: inputValue.trim() });
          break;
        case "OpenAI":
          validateOpenAIMutation.mutate({ apiKey: inputValue.trim() });
          break;
        case "Anthropic":
          validateAnthropicMutation.mutate({ apiKey: inputValue.trim() });
          break;
        case "Google":
          validateGoogleMutation.mutate({ apiKey: inputValue.trim() });
          break;
      }
    }
  };

  // Open sync dialog
  const openSyncDialog = () => {
    setSyncDialogOpen(true);
  };

  // Remove provider functions
  const openRemoveProviderDialog = () => {
    setRemoveProviderDialogOpen(true);
  };

  const confirmRemoveProvider = () => {
    if (isTranscriptionMode) {
      switch (provider) {
        case "OpenAI":
          removeTranscriptionOpenAIProviderMutation.mutate();
          break;
        case "Groq":
          removeTranscriptionGroqProviderMutation.mutate();
          break;
        case "Grok":
          removeTranscriptionGrokProviderMutation.mutate();
          break;
      }
    } else {
      switch (provider) {
        case "OpenRouter":
          removeOpenRouterProviderMutation.mutate();
          break;
        case "Ollama":
          removeOllamaProviderMutation.mutate();
          break;
        case "OpenAI":
          removeOpenAIProviderMutation.mutate();
          break;
        case "Anthropic":
          removeAnthropicProviderMutation.mutate();
          break;
        case "Google":
          removeGoogleProviderMutation.mutate();
          break;
      }
    }
    setRemoveProviderDialogOpen(false);
  };

  const cancelRemoveProvider = () => {
    setRemoveProviderDialogOpen(false);
  };

  function statusIndicator(status: "connected" | "disconnected") {
    return (
      <Badge
        variant="secondary"
        className={cn(
          "text-xs flex items-center gap-1",
          status === "connected"
            ? "text-green-500 border-green-500"
            : "text-red-500 border-red-500",
        )}
      >
        <span
          className={cn(
            "w-2 h-2 rounded-full inline-block animate-pulse mr-1",
            status === "connected" ? "bg-green-500" : "bg-red-500",
          )}
        />
        {status === "connected" ? "Connected" : "Disconnected"}
      </Badge>
    );
  }

  const getPlaceholder = () => {
    if (provider === "Ollama") {
      return "Ollama URL (e.g., http://localhost:11434)";
    }
    return "API Key";
  };

  const getInputType = () => {
    return provider === "Ollama" ? "text" : "password";
  };

  return (
    <>
      <AccordionItem value={provider.toLowerCase()}>
        <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
          <div className="flex w-full items-center justify-between">
            <span className="hover:underline">{provider}</span>
            {statusIndicator(status)}
          </div>
        </AccordionTrigger>
        <AccordionContent className="p-1">
          <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
            <Input
              type={getInputType()}
              placeholder={getPlaceholder()}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="max-w-xs"
              disabled={status === "connected"}
            />
            {status === "disconnected" ? (
              <Button
                variant="outline"
                onClick={handleConnect}
                disabled={!inputValue.trim() || isValidating}
              >
                {isValidating ? (
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
                {!isTranscriptionMode && (
                  <Button variant="outline" onClick={openSyncDialog}>
                    Sync models
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={openRemoveProviderDialog}
                  className="text-destructive hover:text-destructive"
                >
                  Remove Provider
                </Button>
              </div>
            )}
          </div>
          {validationError && (
            <p className="text-xs text-destructive mt-2">{validationError}</p>
          )}
        </AccordionContent>
      </AccordionItem>

      {/* Sync Models Dialog (not used in transcription mode - models are static) */}
      {!isTranscriptionMode && (
        <SyncModelsDialog
          open={syncDialogOpen}
          onOpenChange={setSyncDialogOpen}
          provider={provider}
          modelType={modelType}
        />
      )}

      {/* Remove Provider Confirmation Dialog */}
      <Dialog
        open={removeProviderDialogOpen}
        onOpenChange={setRemoveProviderDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Provider Connection</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove your {provider} connection? This
              will disconnect and remove all synced models from this provider.
              This action cannot be undone.
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
    </>
  );
}
