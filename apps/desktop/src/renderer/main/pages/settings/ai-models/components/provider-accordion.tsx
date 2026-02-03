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
import { useTranslation } from "react-i18next";

interface ProviderAccordionProps {
  provider: "OpenRouter" | "Ollama";
  modelType: "language" | "embedding";
}

export default function ProviderAccordion({
  provider,
  modelType,
}: ProviderAccordionProps) {
  const { t } = useTranslation();
  const providerLabel =
    provider === "OpenRouter"
      ? t("settings.aiModels.providers.openRouter")
      : t("settings.aiModels.providers.ollama");

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

  // tRPC queries and mutations
  const utils = api.useUtils();
  const modelProvidersConfigQuery =
    api.settings.getModelProvidersConfig.useQuery();

  const setOpenRouterConfigMutation =
    api.settings.setOpenRouterConfig.useMutation({
      onSuccess: () => {
        toast.success(
          t("settings.aiModels.provider.toast.configSaved", {
            provider: providerLabel,
          }),
        );
        utils.settings.getModelProvidersConfig.invalidate();
      },
      onError: (error) => {
        console.error("Failed to save OpenRouter config:", error);
        toast.error(
          t("settings.aiModels.provider.toast.configSaveFailed", {
            provider: providerLabel,
          }),
        );
      },
    });

  const setOllamaConfigMutation = api.settings.setOllamaConfig.useMutation({
    onSuccess: () => {
      toast.success(
        t("settings.aiModels.provider.toast.configSaved", {
          provider: providerLabel,
        }),
      );
      utils.settings.getModelProvidersConfig.invalidate();
    },
    onError: (error) => {
      console.error("Failed to save Ollama config:", error);
      toast.error(
        t("settings.aiModels.provider.toast.configSaveFailed", {
          provider: providerLabel,
        }),
      );
    },
  });

  const validateOpenRouterMutation =
    api.models.validateOpenRouterConnection.useMutation({
      onSuccess: (result) => {
        setIsValidating(false);
        if (result.success) {
          setOpenRouterConfigMutation.mutate({ apiKey: inputValue.trim() });
          setValidationError("");
          toast.success(
            t("settings.aiModels.provider.toast.validated", {
              provider: providerLabel,
            }),
          );
        } else {
          setValidationError(
            result.error || t("settings.aiModels.provider.validationFailed"),
          );
          toast.error(
            t("settings.aiModels.provider.toast.validationFailed", {
              provider: providerLabel,
              message: result.error || "",
            }),
          );
        }
      },
      onError: (error) => {
        setIsValidating(false);
        setValidationError(error.message);
        toast.error(
          t("settings.aiModels.provider.toast.validationError", {
            provider: providerLabel,
            message: error.message,
          }),
        );
      },
    });

  const validateOllamaMutation =
    api.models.validateOllamaConnection.useMutation({
      onSuccess: (result) => {
        setIsValidating(false);
        if (result.success) {
          setOllamaConfigMutation.mutate({ url: inputValue.trim() });
          setValidationError("");
          toast.success(
            t("settings.aiModels.provider.toast.validated", {
              provider: providerLabel,
            }),
          );
        } else {
          setValidationError(
            result.error || t("settings.aiModels.provider.validationFailed"),
          );
          toast.error(
            t("settings.aiModels.provider.toast.validationFailed", {
              provider: providerLabel,
              message: result.error || "",
            }),
          );
        }
      },
      onError: (error) => {
        setIsValidating(false);
        setValidationError(error.message);
        toast.error(
          t("settings.aiModels.provider.toast.validationError", {
            provider: providerLabel,
            message: error.message,
          }),
        );
      },
    });

  const removeOpenRouterProviderMutation =
    api.models.removeOpenRouterProvider.useMutation({
      onSuccess: () => {
        utils.settings.getModelProvidersConfig.invalidate();
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getDefaultLanguageModel.invalidate();
        utils.models.getDefaultEmbeddingModel.invalidate();
        setStatus("disconnected");
        setInputValue("");
        toast.success(
          t("settings.aiModels.provider.toast.removed", {
            provider: providerLabel,
          }),
        );
      },
      onError: (error) => {
        console.error("Failed to remove OpenRouter provider:", error);
        toast.error(
          t("settings.aiModels.provider.toast.removeFailed", {
            provider: providerLabel,
          }),
        );
      },
    });

  const removeOllamaProviderMutation =
    api.models.removeOllamaProvider.useMutation({
      onSuccess: () => {
        utils.settings.getModelProvidersConfig.invalidate();
        utils.models.getSyncedProviderModels.invalidate();
        utils.models.getDefaultLanguageModel.invalidate();
        utils.models.getDefaultEmbeddingModel.invalidate();
        setStatus("disconnected");
        setInputValue("");
        toast.success(
          t("settings.aiModels.provider.toast.removed", {
            provider: providerLabel,
          }),
        );
      },
      onError: (error) => {
        console.error("Failed to remove Ollama provider:", error);
        toast.error(
          t("settings.aiModels.provider.toast.removeFailed", {
            provider: providerLabel,
          }),
        );
      },
    });

  // Load configuration when query data is available
  useEffect(() => {
    if (modelProvidersConfigQuery.data) {
      const config = modelProvidersConfigQuery.data;

      if (provider === "OpenRouter") {
        if (config.openRouter?.apiKey) {
          setInputValue(config.openRouter.apiKey);
          setStatus("connected");
        } else {
          setInputValue("");
          setStatus("disconnected");
        }
      } else if (provider === "Ollama") {
        if (config.ollama?.url && config.ollama.url !== "") {
          setInputValue(config.ollama.url);
          setStatus("connected");
        } else {
          setInputValue("");
          setStatus("disconnected");
        }
      }
    }
  }, [modelProvidersConfigQuery.data, provider]);

  // Connect functions with validation
  const handleConnect = () => {
    if (!inputValue.trim()) return;

    setIsValidating(true);
    setValidationError("");

    if (provider === "OpenRouter") {
      validateOpenRouterMutation.mutate({ apiKey: inputValue.trim() });
    } else {
      validateOllamaMutation.mutate({ url: inputValue.trim() });
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
    if (provider === "OpenRouter") {
      removeOpenRouterProviderMutation.mutate();
    } else {
      removeOllamaProviderMutation.mutate();
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
        {status === "connected"
          ? t("settings.aiModels.provider.status.connected")
          : t("settings.aiModels.provider.status.disconnected")}
      </Badge>
    );
  }

  const getPlaceholder = () => {
    if (provider === "OpenRouter") {
      return t("settings.aiModels.provider.placeholders.openRouter");
    } else {
      return t("settings.aiModels.provider.placeholders.ollama");
    }
  };

  const getInputType = () => {
    return provider === "OpenRouter" ? "password" : "text";
  };

  return (
    <>
      <AccordionItem value={provider.toLowerCase()}>
        <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
          <div className="flex w-full items-center justify-between">
            <span className="hover:underline">{providerLabel}</span>
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
                    {t("settings.aiModels.provider.buttons.validating")}
                  </>
                ) : (
                  t("settings.aiModels.provider.buttons.connect")
                )}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={openSyncDialog}>
                  {t("settings.aiModels.provider.buttons.syncModels")}
                </Button>
                <Button
                  variant="outline"
                  onClick={openRemoveProviderDialog}
                  className="text-destructive hover:text-destructive"
                >
                  {t("settings.aiModels.provider.buttons.removeProvider")}
                </Button>
              </div>
            )}
          </div>
          {validationError && (
            <p className="text-xs text-destructive mt-2">{validationError}</p>
          )}
        </AccordionContent>
      </AccordionItem>

      {/* Sync Models Dialog */}
      <SyncModelsDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        provider={provider}
        modelType={modelType}
      />

      {/* Remove Provider Confirmation Dialog */}
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
            <Button variant="outline" onClick={cancelRemoveProvider}>
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
