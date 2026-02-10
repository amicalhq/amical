"use client";
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { toast } from "sonner";

type ProviderName =
  | "OpenRouter"
  | "Ollama"
  | "OpenAI"
  | "Anthropic"
  | "Google"
  | "Groq"
  | "Grok";

const LANGUAGE_PROVIDERS: ProviderName[] = [
  "OpenRouter",
  "Ollama",
  "OpenAI",
  "Anthropic",
  "Google",
];

const SPEECH_PROVIDERS: ProviderName[] = ["OpenAI", "Groq", "Grok"];

const PROVIDER_ICON_MAP: Record<ProviderName, string | null> = {
  OpenAI: "icons/models/openai_dark.svg",
  Google: "icons/models/gemini.svg",
  OpenRouter: "icons/models/open_router.svg",
  Ollama: "icons/models/ollama.svg",
  Anthropic: "icons/models/anthropic.svg",
  Groq: "icons/models/groq.svg",
  Grok: "icons/models/grok.svg",
};

const PROVIDER_ICON_FRAME: Record<ProviderName, string> = {
  OpenAI: "bg-[#10A37F] border-[#10A37F]",
  Anthropic: "bg-[#D4B097] border-[#D4B097]",
  Google: "bg-white border-white",
  OpenRouter: "bg-[#6066F2] border-[#6066F2]",
  Ollama: "bg-white border-slate-200",
  Groq: "bg-[#F55036] border-[#F55036]",
  Grok: "bg-black border-black",
};

const PROVIDER_ICON_CLASS: Record<ProviderName, string> = {
  OpenAI: "",
  Anthropic: "",
  Google: "",
  OpenRouter: "brightness-0 invert",
  Ollama: "",
  Groq: "",
  Grok: "brightness-0 invert",
};

const PROVIDER_ICON_FALLBACK: Record<ProviderName, string> = {
  OpenAI: "text-white",
  Anthropic: "text-slate-900",
  Google: "text-slate-900",
  OpenRouter: "text-white",
  Ollama: "text-white",
  Groq: "text-white",
  Grok: "text-white",
};

const getProviderFallback = (provider: ProviderName) => {
  const caps = provider.replace(/[^A-Z]/g, "");
  if (caps.length >= 2) return caps.slice(0, 2);
  return provider.slice(0, 2).toUpperCase();
};

interface ProviderAccordionProps {
  provider: ProviderName;
  modelType: "language" | "transcription";
  capabilities?: string[];
}

export default function ProviderAccordion({
  provider,
  modelType,
  capabilities,
}: ProviderAccordionProps) {
  const displayCapabilities = (capabilities ?? [])
    .map((capability) => {
      if (capability === "LLM") return "formatting model";
      if (capability === "SPEECH2TEXT" || capability === "Speech-to-Text") {
        return "speech model";
      }
      return capability;
    })
    .filter(
      (capability) =>
        capability === "formatting model" || capability === "speech model",
    )
    .filter((capability, index, list) => list.indexOf(capability) === index);

  // Local state
  const [status, setStatus] = useState<"connected" | "disconnected">(
    "disconnected",
  );
  const [inputValue, setInputValue] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [removeProviderDialogOpen, setRemoveProviderDialogOpen] =
    useState(false);

  const isTranscriptionMode = modelType === "transcription";
  const supportsLanguageModels = LANGUAGE_PROVIDERS.includes(provider);
  const supportsSpeechModels = SPEECH_PROVIDERS.includes(provider);

  // tRPC queries and mutations
  const utils = api.useUtils();
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();

  const resolvedCredentials = useMemo(() => {
    const config = modelProvidersConfigQuery.data;
    const fallbackKey =
      status === "connected" ? inputValue.trim() || undefined : undefined;

    return {
      openRouterApiKey:
        config?.openRouter?.apiKey ??
        (provider === "OpenRouter" ? fallbackKey : undefined),
      ollamaUrl:
        config?.ollama?.url ?? (provider === "Ollama" ? fallbackKey : undefined),
      openAIApiKey:
        config?.openAI?.apiKey ??
        (provider === "OpenAI" ? fallbackKey : undefined),
      anthropicApiKey:
        config?.anthropic?.apiKey ??
        (provider === "Anthropic" ? fallbackKey : undefined),
      googleApiKey:
        config?.google?.apiKey ??
        (provider === "Google" ? fallbackKey : undefined),
    };
  }, [inputValue, modelProvidersConfigQuery.data, provider, status]);

  const fetchOpenRouterModelsQuery = api.models.fetchOpenRouterModels.useQuery(
    { apiKey: resolvedCredentials.openRouterApiKey ?? "" },
    {
      enabled:
        status === "connected" &&
        provider === "OpenRouter" &&
        !!resolvedCredentials.openRouterApiKey,
    },
  );

  const fetchOllamaModelsQuery = api.models.fetchOllamaModels.useQuery(
    { url: resolvedCredentials.ollamaUrl ?? "" },
    {
      enabled:
        status === "connected" &&
        provider === "Ollama" &&
        !!resolvedCredentials.ollamaUrl,
    },
  );

  const fetchOpenAIModelsQuery = api.models.fetchOpenAIModels.useQuery(
    { apiKey: resolvedCredentials.openAIApiKey ?? "" },
    {
      enabled:
        status === "connected" &&
        provider === "OpenAI" &&
        !!resolvedCredentials.openAIApiKey,
    },
  );

  const fetchAnthropicModelsQuery = api.models.fetchAnthropicModels.useQuery(
    { apiKey: resolvedCredentials.anthropicApiKey ?? "" },
    {
      enabled:
        status === "connected" &&
        provider === "Anthropic" &&
        !!resolvedCredentials.anthropicApiKey,
    },
  );

  const fetchGoogleModelsQuery = api.models.fetchGoogleModels.useQuery(
    { apiKey: resolvedCredentials.googleApiKey ?? "" },
    {
      enabled:
        status === "connected" &&
        provider === "Google" &&
        !!resolvedCredentials.googleApiKey,
    },
  );

  const availableSpeechModelsQuery = api.models.getAvailableModels.useQuery(
    undefined,
    { enabled: status === "connected" && supportsSpeechModels },
  );

  const activeLanguageQuery = useMemo(() => {
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
      default:
        return undefined;
    }
  }, [
    fetchAnthropicModelsQuery,
    fetchGoogleModelsQuery,
    fetchOllamaModelsQuery,
    fetchOpenAIModelsQuery,
    fetchOpenRouterModelsQuery,
    provider,
  ]);

  const languageModels = useMemo(() => {
    if (!supportsLanguageModels) return [];
    const models = activeLanguageQuery?.data ?? [];

    if (provider === "Ollama") {
      return models.filter((model) => {
        const haystack = `${model.name} ${model.id}`.toLowerCase();
        return !haystack.includes("embed");
      });
    }

    return models;
  }, [activeLanguageQuery?.data, provider, supportsLanguageModels]);

  const speechModels = useMemo(() => {
    if (!supportsSpeechModels) return [];
    const models = availableSpeechModelsQuery.data ?? [];
    return models.filter(
      (model) => model.setup === "api" && model.provider === provider,
    );
  }, [availableSpeechModelsQuery.data, provider, supportsSpeechModels]);

  const isLanguageFetching =
    !!activeLanguageQuery?.isLoading || !!activeLanguageQuery?.isFetching;
  const languageError = activeLanguageQuery?.error?.message;
  const isSpeechFetching =
    availableSpeechModelsQuery.isLoading ||
    availableSpeechModelsQuery.isFetching;

  const syncProviderModelsMutation =
    api.models.syncProviderModelsToDatabase.useMutation({
      onSuccess: () => {
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getModels.invalidate();
        toast.success("Models synced successfully!");
      },
      onError: (error) => {
        console.error("Failed to sync models:", error);
        toast.error("Failed to sync models. Please try again.");
      },
    });

  const syncLanguageModelsAfterConnect = async (
    providerName: ProviderName,
    credential: string,
  ) => {
    const trimmedCredential = credential.trim();
    if (!trimmedCredential || !LANGUAGE_PROVIDERS.includes(providerName)) {
      return;
    }

    try {
      let fetchedModels: unknown[] = [];

      switch (providerName) {
        case "OpenRouter":
          fetchedModels = await utils.models.fetchOpenRouterModels.fetch({
            apiKey: trimmedCredential,
          });
          break;
        case "Ollama":
          fetchedModels = await utils.models.fetchOllamaModels.fetch({
            url: trimmedCredential,
          });
          break;
        case "OpenAI":
          fetchedModels = await utils.models.fetchOpenAIModels.fetch({
            apiKey: trimmedCredential,
          });
          break;
        case "Anthropic":
          fetchedModels = await utils.models.fetchAnthropicModels.fetch({
            apiKey: trimmedCredential,
          });
          break;
        case "Google":
          fetchedModels = await utils.models.fetchGoogleModels.fetch({
            apiKey: trimmedCredential,
          });
          break;
        default:
          return;
      }

      await syncProviderModelsMutation.mutateAsync({
        provider: providerName,
        models: fetchedModels,
      });
    } catch (error) {
      console.error(`Auto-sync failed for ${providerName}:`, error);
      toast.error(
        `${providerName} connected, but model sync failed. Try the Sync button.`,
      );
      await utils.models.getModels.invalidate();
    }
  };

  // --- Config save mutations ---
  const setOpenRouterConfigMutation =
    api.settings.setOpenRouterConfig.useMutation({
      onSuccess: async (_data, variables) => {
        toast.success("OpenRouter configuration saved successfully!");
        await utils.settings.getModelProvidersConfig.invalidate();
        await syncLanguageModelsAfterConnect("OpenRouter", variables.apiKey);
      },
      onError: (error) => {
        console.error("Failed to save OpenRouter config:", error);
        toast.error(
          "Failed to save OpenRouter configuration. Please try again.",
        );
      },
    });

  const setOllamaConfigMutation = api.settings.setOllamaConfig.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success("Ollama configuration saved successfully!");
      await utils.settings.getModelProvidersConfig.invalidate();
      await syncLanguageModelsAfterConnect("Ollama", variables.url);
    },
    onError: (error) => {
      console.error("Failed to save Ollama config:", error);
      toast.error("Failed to save Ollama configuration. Please try again.");
    },
  });

  const setOpenAIConfigMutation = api.settings.setOpenAIConfig.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success("OpenAI configuration saved successfully!");
      await utils.settings.getModelProvidersConfig.invalidate();
      await utils.models.getTranscriptionProviderStatus.invalidate();
      await syncLanguageModelsAfterConnect("OpenAI", variables.apiKey);
    },
    onError: (error) => {
      console.error("Failed to save OpenAI config:", error);
      toast.error("Failed to save OpenAI configuration. Please try again.");
    },
  });

  const setAnthropicConfigMutation =
    api.settings.setAnthropicConfig.useMutation({
      onSuccess: async (_data, variables) => {
        toast.success("Anthropic configuration saved successfully!");
        await utils.settings.getModelProvidersConfig.invalidate();
        await syncLanguageModelsAfterConnect("Anthropic", variables.apiKey);
      },
      onError: (error) => {
        console.error("Failed to save Anthropic config:", error);
        toast.error(
          "Failed to save Anthropic configuration. Please try again.",
        );
      },
    });

  const setGoogleConfigMutation = api.settings.setGoogleConfig.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success("Google configuration saved successfully!");
      await utils.settings.getModelProvidersConfig.invalidate();
      await syncLanguageModelsAfterConnect("Google", variables.apiKey);
    },
    onError: (error) => {
      console.error("Failed to save Google config:", error);
      toast.error("Failed to save Google configuration. Please try again.");
    },
  });

  const setGroqConfigMutation = api.settings.setGroqConfig.useMutation({
    onSuccess: () => {
      toast.success("Groq configuration saved successfully!");
      utils.settings.getModelProvidersConfig.invalidate();
      utils.models.getTranscriptionProviderStatus.invalidate();
      utils.models.getModels.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save Groq config:", error);
      toast.error("Failed to save Groq configuration. Please try again.");
    },
  });

  const setGrokConfigMutation = api.settings.setGrokConfig.useMutation({
    onSuccess: () => {
      toast.success("Grok configuration saved successfully!");
      utils.settings.getModelProvidersConfig.invalidate();
      utils.models.getTranscriptionProviderStatus.invalidate();
      utils.models.getModels.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save Grok config:", error);
      toast.error("Failed to save Grok configuration. Please try again.");
    },
  });

  // --- Transcription validation mutations ---
  const validateTranscriptionGroqMutation =
    api.models.validateTranscriptionGroqConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Groq", () =>
          setGroqConfigMutation.mutate({
            apiKey: inputValue.trim(),
          }),
        ),
      onError: (error) => onValidationError(error, "Groq"),
    });

  const validateTranscriptionGrokMutation =
    api.models.validateTranscriptionGrokConnection.useMutation({
      onSuccess: (result) =>
        onValidationSuccess(result, "Grok", () =>
          setGrokConfigMutation.mutate({
            apiKey: inputValue.trim(),
          }),
        ),
      onError: (error) => onValidationError(error, "Grok"),
    });

  // --- Transcription remove provider mutations ---
  const removeGroqProviderMutation = api.models.removeGroqProvider.useMutation({
    onSuccess: () => {
      utils.settings.getModelProvidersConfig.invalidate();
      utils.models.getTranscriptionProviderStatus.invalidate();
      utils.models.getSelectedModel.invalidate();
      utils.models.getModels.invalidate();
      setStatus("disconnected");
      setInputValue("");
      toast.success("Groq provider removed!");
    },
    onError: (error) => onRemoveError(error, "Groq"),
  });

  const removeGrokProviderMutation = api.models.removeGrokProvider.useMutation({
    onSuccess: () => {
      utils.settings.getModelProvidersConfig.invalidate();
      utils.models.getTranscriptionProviderStatus.invalidate();
      utils.models.getSelectedModel.invalidate();
      utils.models.getModels.invalidate();
      setStatus("disconnected");
      setInputValue("");
      toast.success("Grok provider removed!");
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
    utils.models.getTranscriptionProviderStatus.invalidate();
    utils.models.getModels.invalidate();
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
    if (!modelProvidersConfigQuery.data) {
      return;
    }

    const config = modelProvidersConfigQuery.data;
    let credential: string | undefined;

    switch (provider) {
      case "OpenRouter":
        credential = config.openRouter?.apiKey;
        break;
      case "Ollama":
        credential =
          config.ollama?.url && config.ollama.url !== ""
            ? config.ollama.url
            : undefined;
        break;
      case "OpenAI":
        credential = config.openAI?.apiKey;
        break;
      case "Groq":
        credential = config.groq?.apiKey;
        break;
      case "Grok":
        credential = config.grok?.apiKey;
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
  }, [modelProvidersConfigQuery.data, provider]);

  // Connect functions with validation
  const handleConnect = () => {
    if (!inputValue.trim()) return;

    setIsValidating(true);
    setValidationError("");

    if (isTranscriptionMode) {
      switch (provider) {
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

  const handleSyncAllModels = async () => {
    if (!supportsLanguageModels) return;
    try {
      const refetchResult = await activeLanguageQuery?.refetch?.();
      const models = (refetchResult?.data ?? languageModels).filter(
        (model) => model.provider === provider,
      );

      if (models.length === 0) {
        toast.info("No models available to sync.");
        return;
      }

      await syncProviderModelsMutation.mutateAsync({
        provider,
        models,
      });
    } catch (error) {
      console.error("Failed to sync models:", error);
      toast.error("Failed to sync models. Please try again.");
    }
  };

  // Remove provider functions
  const openRemoveProviderDialog = () => {
    setRemoveProviderDialogOpen(true);
  };

  const confirmRemoveProvider = () => {
    if (isTranscriptionMode) {
      switch (provider) {
        case "Groq":
          removeGroqProviderMutation.mutate();
          break;
        case "Grok":
          removeGrokProviderMutation.mutate();
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
    if (status !== "connected") {
      return null;
    }

    return (
      <Badge
        variant="secondary"
        className="text-xs flex items-center gap-1 text-green-500"
      >
        <span
          className="w-2 h-2 rounded-full inline-block animate-pulse mr-1 bg-green-500"
        />
        Connected
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
      <AccordionItem
        value={provider.toLowerCase()}
        className="rounded-lg border border-border bg-muted/30 px-4 py-2 data-[state=open]:bg-muted/40 last:!border-b"
      >
        <AccordionTrigger className="py-2 no-underline hover:no-underline group-hover:no-underline">
          <div className="flex w-full items-center justify-between gap-4">
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Avatar
                  className={cn(
                    "h-7 w-7 rounded-md border",
                    PROVIDER_ICON_FRAME[provider],
                  )}
                >
                  {PROVIDER_ICON_MAP[provider] ? (
                    <AvatarImage
                      src={PROVIDER_ICON_MAP[provider] as string}
                      alt={`${provider} logo`}
                      className={cn(
                        "object-contain p-0.5",
                        PROVIDER_ICON_CLASS[provider],
                      )}
                    />
                  ) : null}
                  <AvatarFallback
                    className={cn(
                      "rounded-md text-[10px] font-semibold",
                      PROVIDER_ICON_FALLBACK[provider],
                    )}
                  >
                    {getProviderFallback(provider)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-semibold">{provider}</span>
                {displayCapabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {displayCapabilities.map((capability) => (
                      <Badge
                        key={capability}
                        variant="secondary"
                        className="bg-white/12 text-foreground text-[10px] px-1.5 py-0 tracking-wide font-semibold"
                      >
                        {capability}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSyncAllModels}
                    aria-label="Sync models"
                    title="Sync models"
                    disabled={
                      syncProviderModelsMutation.isPending || isLanguageFetching
                    }
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4",
                        syncProviderModelsMutation.isPending && "animate-spin",
                      )}
                    />
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={openRemoveProviderDialog}
                  className="text-destructive hover:text-destructive"
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>
          {validationError && (
            <p className="text-xs text-destructive mt-2">{validationError}</p>
          )}

          {status === "connected" &&
            (supportsLanguageModels || supportsSpeechModels) && (
              <div className="mt-4 space-y-3">
                {supportsLanguageModels && (
                  <div className="rounded-md border border-border/60 bg-background/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        formatting model
                      </span>
                      {isLanguageFetching && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {languageError ? (
                      <p className="mt-2 text-xs text-destructive">
                        {languageError}
                      </p>
                    ) : languageModels.length === 0 &&
                      !isLanguageFetching ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        No models available.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {languageModels.map((model) => (
                          <div
                            key={model.id}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="text-foreground">
                              {model.name || model.id}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {model.id}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {supportsSpeechModels && (
                  <div className="rounded-md border border-border/60 bg-background/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        speech model
                      </span>
                      {isSpeechFetching && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {speechModels.length === 0 && !isSpeechFetching ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        No models available.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {speechModels.map((model) => (
                          <div
                            key={model.id}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="text-foreground">
                              {model.name || model.id}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {"apiModelId" in model ? model.apiModelId : model.id}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </AccordionContent>
      </AccordionItem>

      {/* Disconnect Provider Confirmation Dialog */}
      <Dialog
        open={removeProviderDialogOpen}
        onOpenChange={setRemoveProviderDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Provider</DialogTitle>
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
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
