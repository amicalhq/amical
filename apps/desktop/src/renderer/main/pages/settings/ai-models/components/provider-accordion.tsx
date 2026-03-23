"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import SyncModelsDialog from "./sync-models-dialog";
import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "@/constants/remote-providers";

interface ProviderAccordionProps {
  provider: RemoteProvider;
  modelType: "language" | "embedding";
}

export default function ProviderAccordion({
  provider,
  modelType,
}: ProviderAccordionProps) {
  const { t } = useTranslation();
  const utils = api.useUtils();

  const [status, setStatus] = useState<"connected" | "disconnected">(
    "disconnected",
  );
  const [inputValue, setInputValue] = useState("");
  const [baseURLValue, setBaseURLValue] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [removeProviderDialogOpen, setRemoveProviderDialogOpen] =
    useState(false);

  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();

  const providerLabel =
    provider === REMOTE_PROVIDERS.openRouter
      ? t("settings.aiModels.providers.openRouter")
      : provider === REMOTE_PROVIDERS.ollama
        ? t("settings.aiModels.providers.ollama")
        : t("settings.aiModels.providers.openAICompatible");

  const invalidateProviderQueries = () => {
    utils.settings.getModelProvidersConfig.invalidate();
    utils.models.getSyncedProviderModels.invalidate();
    utils.models.getDefaultLanguageModel.invalidate();
    utils.models.getDefaultEmbeddingModel.invalidate();
  };

  const handleConfigSaved = () => {
    toast.success(
      t("settings.aiModels.provider.toast.configSaved", {
        provider: providerLabel,
      }),
    );
    invalidateProviderQueries();
  };

  const handleConfigSaveFailed = () => {
    toast.error(
      t("settings.aiModels.provider.toast.configSaveFailed", {
        provider: providerLabel,
      }),
    );
  };

  const setOpenRouterConfigMutation =
    api.settings.setOpenRouterConfig.useMutation({
      onSuccess: handleConfigSaved,
      onError: (error) => {
        console.error("Failed to save OpenRouter config:", error);
        handleConfigSaveFailed();
      },
    });

  const setOllamaConfigMutation = api.settings.setOllamaConfig.useMutation({
    onSuccess: handleConfigSaved,
    onError: (error) => {
      console.error("Failed to save Ollama config:", error);
      handleConfigSaveFailed();
    },
  });

  const setOpenAICompatibleConfigMutation =
    api.settings.setOpenAICompatibleConfig.useMutation({
      onSuccess: handleConfigSaved,
      onError: (error) => {
        console.error("Failed to save OpenAI-compatible config:", error);
        handleConfigSaveFailed();
      },
    });

  const handleValidationSuccess = (success: boolean, error?: string) => {
    setIsValidating(false);

    if (success) {
      if (provider === REMOTE_PROVIDERS.openRouter) {
        setOpenRouterConfigMutation.mutate({ apiKey: inputValue.trim() });
      } else if (provider === REMOTE_PROVIDERS.ollama) {
        setOllamaConfigMutation.mutate({ url: inputValue.trim() });
      } else {
        setOpenAICompatibleConfigMutation.mutate({
          apiKey: inputValue.trim(),
          baseURL: baseURLValue.trim(),
        });
      }

      setValidationError("");
      toast.success(
        t("settings.aiModels.provider.toast.validated", {
          provider: providerLabel,
        }),
      );
      return;
    }

    setValidationError(
      error || t("settings.aiModels.provider.validationFailed"),
    );
    toast.error(
      t("settings.aiModels.provider.toast.validationFailed", {
        provider: providerLabel,
        message: error || "",
      }),
    );
  };

  const handleValidationError = (error: { message: string }) => {
    setIsValidating(false);
    setValidationError(error.message);
    toast.error(
      t("settings.aiModels.provider.toast.validationError", {
        provider: providerLabel,
        message: error.message,
      }),
    );
  };

  const validateOpenRouterMutation =
    api.models.validateOpenRouterConnection.useMutation({
      onSuccess: (result) =>
        handleValidationSuccess(result.success, result.error),
      onError: handleValidationError,
    });

  const validateOllamaMutation =
    api.models.validateOllamaConnection.useMutation({
      onSuccess: (result) =>
        handleValidationSuccess(result.success, result.error),
      onError: handleValidationError,
    });

  const validateOpenAICompatibleMutation =
    api.models.validateOpenAICompatibleConnection.useMutation({
      onSuccess: (result) =>
        handleValidationSuccess(result.success, result.error),
      onError: handleValidationError,
    });

  const handleProviderRemoved = () => {
    invalidateProviderQueries();
    setStatus("disconnected");
    setInputValue("");
    setBaseURLValue("");
    toast.success(
      t("settings.aiModels.provider.toast.removed", {
        provider: providerLabel,
      }),
    );
  };

  const handleProviderRemoveFailed = () => {
    toast.error(
      t("settings.aiModels.provider.toast.removeFailed", {
        provider: providerLabel,
      }),
    );
  };

  const removeOpenRouterProviderMutation =
    api.models.removeOpenRouterProvider.useMutation({
      onSuccess: handleProviderRemoved,
      onError: (error) => {
        console.error("Failed to remove OpenRouter provider:", error);
        handleProviderRemoveFailed();
      },
    });

  const removeOllamaProviderMutation =
    api.models.removeOllamaProvider.useMutation({
      onSuccess: handleProviderRemoved,
      onError: (error) => {
        console.error("Failed to remove Ollama provider:", error);
        handleProviderRemoveFailed();
      },
    });

  const removeOpenAICompatibleProviderMutation =
    api.models.removeOpenAICompatibleProvider.useMutation({
      onSuccess: handleProviderRemoved,
      onError: (error) => {
        console.error("Failed to remove OpenAI-compatible provider:", error);
        handleProviderRemoveFailed();
      },
    });

  useEffect(() => {
    const config = modelProvidersConfigQuery.data;
    if (!config) {
      return;
    }

    if (provider === REMOTE_PROVIDERS.openRouter) {
      if (config.openRouter?.apiKey) {
        setInputValue(config.openRouter.apiKey);
        setBaseURLValue("");
        setStatus("connected");
      } else {
        setInputValue("");
        setBaseURLValue("");
        setStatus("disconnected");
      }
      return;
    }

    if (provider === REMOTE_PROVIDERS.ollama) {
      if (config.ollama?.url) {
        setInputValue(config.ollama.url);
        setBaseURLValue("");
        setStatus("connected");
      } else {
        setInputValue("");
        setBaseURLValue("");
        setStatus("disconnected");
      }
      return;
    }

    if (config.openAICompatible?.apiKey && config.openAICompatible.baseURL) {
      setInputValue(config.openAICompatible.apiKey);
      setBaseURLValue(config.openAICompatible.baseURL);
      setStatus("connected");
    } else {
      setInputValue("");
      setBaseURLValue("");
      setStatus("disconnected");
    }
  }, [modelProvidersConfigQuery.data, provider]);

  const handleConnect = () => {
    const trimmedInput = inputValue.trim();
    const trimmedBaseURL = baseURLValue.trim();

    if (provider === REMOTE_PROVIDERS.openAICompatible) {
      if (!trimmedInput || !trimmedBaseURL) {
        return;
      }
    } else if (!trimmedInput) {
      return;
    }

    if (provider === REMOTE_PROVIDERS.openRouter) {
      setIsValidating(true);
      setValidationError("");
      validateOpenRouterMutation.mutate({ apiKey: trimmedInput });
      return;
    }

    if (provider === REMOTE_PROVIDERS.ollama) {
      setIsValidating(true);
      setValidationError("");
      validateOllamaMutation.mutate({ url: trimmedInput });
      return;
    }

    setIsValidating(true);
    setValidationError("");
    validateOpenAICompatibleMutation.mutate({
      apiKey: trimmedInput,
      baseURL: trimmedBaseURL,
    });
  };

  const confirmRemoveProvider = () => {
    if (provider === REMOTE_PROVIDERS.openRouter) {
      removeOpenRouterProviderMutation.mutate();
    } else if (provider === REMOTE_PROVIDERS.ollama) {
      removeOllamaProviderMutation.mutate();
    } else {
      removeOpenAICompatibleProviderMutation.mutate();
    }

    setRemoveProviderDialogOpen(false);
  };

  const canConnect =
    provider === REMOTE_PROVIDERS.openAICompatible
      ? Boolean(inputValue.trim() && baseURLValue.trim())
      : Boolean(inputValue.trim());

  const providerValue = provider.toLowerCase().replace(/\s+/g, "-");

  const statusIndicator = (providerStatus: "connected" | "disconnected") => (
    <Badge
      variant="secondary"
      className={cn(
        "text-xs flex items-center gap-1",
        providerStatus === "connected"
          ? "text-green-500 border-green-500"
          : "text-red-500 border-red-500",
      )}
    >
      <span
        className={cn(
          "w-2 h-2 rounded-full inline-block animate-pulse mr-1",
          providerStatus === "connected" ? "bg-green-500" : "bg-red-500",
        )}
      />
      {providerStatus === "connected"
        ? t("settings.aiModels.provider.status.connected")
        : t("settings.aiModels.provider.status.disconnected")}
    </Badge>
  );

  return (
    <>
      <AccordionItem value={providerValue}>
        <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
          <div className="flex w-full items-center justify-between">
            <span className="hover:underline">{providerLabel}</span>
            {statusIndicator(status)}
          </div>
        </AccordionTrigger>
        <AccordionContent className="p-1">
          <div className="flex flex-col gap-4 mb-2">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              {provider === REMOTE_PROVIDERS.openAICompatible ? (
                <>
                  <Input
                    type="text"
                    placeholder={t(
                      "settings.aiModels.provider.placeholders.openAICompatibleBaseURL",
                    )}
                    value={baseURLValue}
                    onChange={(e) => setBaseURLValue(e.target.value)}
                    className="max-w-xs"
                    disabled={status === "connected"}
                  />
                  <Input
                    type="password"
                    placeholder={t(
                      "settings.aiModels.provider.placeholders.openAICompatibleApiKey",
                    )}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="max-w-xs"
                    disabled={status === "connected"}
                  />
                </>
              ) : (
                <Input
                  type={
                    provider === REMOTE_PROVIDERS.openRouter
                      ? "password"
                      : "text"
                  }
                  placeholder={t(
                    provider === REMOTE_PROVIDERS.openRouter
                      ? "settings.aiModels.provider.placeholders.openRouter"
                      : "settings.aiModels.provider.placeholders.ollama",
                  )}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="max-w-xs"
                  disabled={status === "connected"}
                />
              )}

              {status === "disconnected" ? (
                <Button
                  variant="outline"
                  onClick={handleConnect}
                  disabled={!canConnect || isValidating}
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("settings.aiModels.provider.buttons.validating")}
                    </>
                  ) : (
                    t("settings.aiModels.provider.buttons.connect")
                  )}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setSyncDialogOpen(true)}
                  >
                    {t("settings.aiModels.provider.buttons.syncModels")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRemoveProviderDialogOpen(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    {t("settings.aiModels.provider.buttons.removeProvider")}
                  </Button>
                </div>
              )}
            </div>

            {validationError && (
              <p className="text-xs text-destructive">{validationError}</p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      <SyncModelsDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        provider={provider}
        modelType={modelType}
      />

      <Dialog
        open={removeProviderDialogOpen}
        onOpenChange={setRemoveProviderDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.aiModels.provider.removeDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.aiModels.provider.removeDialog.description", {
                provider: providerLabel,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveProviderDialogOpen(false)}
            >
              {t("settings.aiModels.provider.removeDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmRemoveProvider}>
              {t("settings.aiModels.provider.removeDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
