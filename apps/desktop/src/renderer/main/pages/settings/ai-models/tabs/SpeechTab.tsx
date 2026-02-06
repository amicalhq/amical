"use client";
import { ComponentProps, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  Zap,
  Circle,
  Square,
  Loader2,
  Trash2,
} from "lucide-react";
import { DynamicIcon } from "lucide-react/dynamic";
import { Button } from "@/components/ui/button";
import {
  TooltipContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { DownloadProgress } from "@/constants/models";
import { Key } from "lucide-react";
import { api } from "@/trpc/react";

const SpeedRating = ({ rating }: { rating: number }) => {
  const fullIcons = Math.floor(rating);
  const hasHalf = rating % 1 !== 0;

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        if (i < fullIcons) {
          return (
            <Zap key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
          );
        } else if (i === fullIcons && hasHalf) {
          return (
            <div key={i} className="relative w-4 h-4">
              <Zap className="w-4 h-4 text-gray-300" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <Zap className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              </div>
            </div>
          );
        } else {
          return <Zap key={i} className="w-4 h-4 text-gray-300" />;
        }
      })}
      <span className="text-sm text-muted-foreground ml-1">{rating}</span>
    </div>
  );
};

const AccuracyRating = ({ rating }: { rating: number }) => {
  const fullIcons = Math.floor(rating);
  const hasHalf = rating % 1 !== 0;

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        if (i < fullIcons) {
          return (
            <Circle key={i} className="w-4 h-4 fill-green-500 text-green-500" />
          );
        } else if (i === fullIcons && hasHalf) {
          return (
            <div key={i} className="relative w-4 h-4">
              <Circle className="w-4 h-4 text-gray-300" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <Circle className="w-4 h-4 fill-green-500 text-green-500" />
              </div>
            </div>
          );
        } else {
          return <Circle key={i} className="w-4 h-4 text-gray-300" />;
        }
      })}
      <span className="text-sm text-muted-foreground ml-1">{rating}</span>
    </div>
  );
};

export default function SpeechTab() {
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, DownloadProgress>
  >({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);

  // tRPC queries
  const availableModelsQuery = api.models.getAvailableModels.useQuery();
  const downloadedModelsQuery = api.models.getDownloadedModels.useQuery();
  const activeDownloadsQuery = api.models.getActiveDownloads.useQuery();
  const isTranscriptionAvailableQuery =
    api.models.isTranscriptionAvailable.useQuery();
  const selectedModelQuery = api.models.getSelectedModel.useQuery();
  const transcriptionProviderStatusQuery =
    api.models.getTranscriptionProviderStatus.useQuery();

  const utils = api.useUtils();

  // tRPC mutations
  const downloadModelMutation = api.models.downloadModel.useMutation({
    onSuccess: () => {
      utils.models.getDownloadedModels.invalidate();
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Failed to start download:", error);
      toast.error("Failed to start download");
    },
  });

  const cancelDownloadMutation = api.models.cancelDownload.useMutation({
    onSuccess: () => {
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Failed to cancel download:", error);
      toast.error("Failed to cancel download");
    },
  });

  const deleteModelMutation = api.models.deleteModel.useMutation({
    onSuccess: () => {
      utils.models.getDownloadedModels.invalidate();
      setShowDeleteDialog(false);
      setModelToDelete(null);
    },
    onError: (error) => {
      console.error("Failed to delete model:", error);
      toast.error("Failed to delete model");
      setShowDeleteDialog(false);
      setModelToDelete(null);
    },
  });

  const setSelectedModelMutation = api.models.setSelectedModel.useMutation({
    onSuccess: (_data, variables) => {
      utils.models.getSelectedModel.invalidate();
    },
    onError: (error) => {
      console.error("Failed to select model:", error);
      toast.error("Failed to select model");
    },
  });

  // Initialize active downloads progress on load
  useEffect(() => {
    if (activeDownloadsQuery.data) {
      const progressMap: Record<string, DownloadProgress> = {};
      activeDownloadsQuery.data.forEach((download) => {
        progressMap[download.modelId] = download;
      });
      setDownloadProgress(progressMap);
    }
  }, [activeDownloadsQuery.data]);

  // Set up tRPC subscriptions for real-time download updates
  api.models.onDownloadProgress.useSubscription(undefined, {
    onData: ({ modelId, progress }) => {
      setDownloadProgress((prev) => ({ ...prev, [modelId]: progress }));
    },
    onError: (error) => {
      console.error("Download progress subscription error:", error);
    },
  });

  api.models.onDownloadComplete.useSubscription(undefined, {
    onData: ({ modelId }) => {
      setDownloadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[modelId];
        return newProgress;
      });
      utils.models.getDownloadedModels.invalidate();
      utils.models.getActiveDownloads.invalidate();
      // Also invalidate selected model in case of auto-selection
      utils.models.getSelectedModel.invalidate();
    },
    onError: (error) => {
      console.error("Download complete subscription error:", error);
    },
  });

  api.models.onDownloadError.useSubscription(undefined, {
    onData: ({ modelId, error }) => {
      setDownloadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[modelId];
        return newProgress;
      });
      toast.error(`Download failed: ${error}`);
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Download error subscription error:", error);
    },
  });

  api.models.onDownloadCancelled.useSubscription(undefined, {
    onData: ({ modelId }) => {
      setDownloadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[modelId];
        return newProgress;
      });
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Download cancelled subscription error:", error);
    },
  });

  api.models.onModelDeleted.useSubscription(undefined, {
    onData: () => {
      utils.models.getDownloadedModels.invalidate();
    },
    onError: (error) => {
      console.error("Model deleted subscription error:", error);
    },
  });

  const handleDownload = async (modelId: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await downloadModelMutation.mutateAsync({ modelId });
      console.log("Download started for:", modelId);
    } catch (err) {
      console.error("Failed to start download:", err);
      // Error is already handled by the mutation's onError
    }
  };

  const handleCancelDownload = async (
    modelId: string,
    event?: React.MouseEvent,
  ) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await cancelDownloadMutation.mutateAsync({ modelId });
      console.log("Cancel download successful for:", modelId);
    } catch (err) {
      console.error("Failed to cancel download:", err);
      // Error is already handled by the mutation's onError
    }
  };

  const handleDeleteClick = (modelId: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setModelToDelete(modelId);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!modelToDelete) return;

    try {
      await deleteModelMutation.mutateAsync({ modelId: modelToDelete });
    } catch (err) {
      console.error("Failed to delete model:", err);
      // Error is already handled by the mutation's onError
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteDialog(false);
    setModelToDelete(null);
  };

  const handleSelectModel = async (modelId: string) => {
    const model = availableModels.find((m) => m.id === modelId);

    // If API model without configured API key, show guidance
    if (model?.setup === "api") {
      const hasKey =
        (model.provider === "OpenAI" && apiKeyStatus.openAI) ||
        (model.provider === "Groq" && apiKeyStatus.groq) ||
        (model.provider === "Grok" && apiKeyStatus.grok);
      if (!hasKey) {
        toast.error(
          `Please configure your ${model.provider} API key in the Models section.`,
        );
        return;
      }
    }

    try {
      await setSelectedModelMutation.mutateAsync({ modelId });
    } catch (err) {
      console.error("Failed to select model:", err);
      // Error is already handled by the mutation's onError
    }
  };

  // Loading state
  const loading =
    availableModelsQuery.isLoading ||
    downloadedModelsQuery.isLoading ||
    isTranscriptionAvailableQuery.isLoading ||
    selectedModelQuery.isLoading;

  // Data from queries
  const availableModels = availableModelsQuery.data || [];
  const downloadedModels = downloadedModelsQuery.data || {};
  const isTranscriptionAvailable = isTranscriptionAvailableQuery.data || false;
  const selectedModel = selectedModelQuery.data;
  const apiKeyStatus = transcriptionProviderStatusQuery.data || {
    openAI: false,
    groq: false,
    grok: false,
  };
  const visibleModels = availableModels.filter((model) => {
    if (model.setup !== "api") return true;
    return (
      (model.provider === "OpenAI" && apiKeyStatus.openAI) ||
      (model.provider === "Groq" && apiKeyStatus.groq) ||
      (model.provider === "Grok" && apiKeyStatus.grok)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading models...</span>
      </div>
    );
  }
  return (
    <>
      <Card>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-lg font-semibold mb-2 block">
              Available Models
            </Label>
            <div className="divide-y border rounded-md bg-muted/30">
              <TooltipProvider>
                <RadioGroup
                  value={selectedModel || ""}
                  onValueChange={handleSelectModel}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead>Features</TableHead>
                        <TableHead>Speed</TableHead>
                        <TableHead>Accuracy</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleModels.map((model) => {
                        const isDownloaded = !!downloadedModels[model.id];
                        const progress = downloadProgress[model.id];
                        const isDownloading =
                          progress?.status === "downloading";
                        const isApiModel = model.setup === "api";
                        const isOfflineModel = model.setup === "offline";

                        // Check if API model's provider has API key configured
                        const hasApiKey = isApiModel
                          ? (model.provider === "OpenAI" && apiKeyStatus.openAI) ||
                            (model.provider === "Groq" && apiKeyStatus.groq) ||
                            (model.provider === "Grok" && apiKeyStatus.grok)
                          : false;

                        // Selection logic based on model setup type
                        const canSelect = isApiModel
                          ? hasApiKey
                          : isDownloaded && isTranscriptionAvailable;

                        return (
                          <TableRow
                            key={model.id}
                            className={`hover:bg-muted/50 ${canSelect ? "cursor-pointer" : ""}`}
                            onClick={() =>
                              canSelect && handleSelectModel(model.id)
                            }
                          >
                            <TableCell>
                              <div className="flex items-center space-x-3">
                                <RadioGroupItem
                                  value={model.id}
                                  id={model.id}
                                  disabled={!canSelect}
                                />
                                <div>
                                  <Label
                                    htmlFor={model.id}
                                    className="font-semibold cursor-pointer"
                                  >
                                    {model.name}
                                  </Label>
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                    <Avatar className="w-4 h-4">
                                      <AvatarImage
                                        src={model.providerIcon}
                                        alt={`${model.provider} icon`}
                                      />
                                      <AvatarFallback className="text-xs">
                                        {model.provider.charAt(0).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span>{model.provider}</span>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                {model.features.map((feature, featureIndex) => (
                                  <Tooltip key={featureIndex}>
                                    <TooltipTrigger asChild>
                                      <div className="p-2 rounded-md bg-muted hover:bg-muted/80 cursor-help transition-colors">
                                        {
                                          <DynamicIcon
                                            name={
                                              feature.icon as ComponentProps<
                                                typeof DynamicIcon
                                              >["name"]
                                            }
                                            className="w-4 h-4"
                                          />
                                        }
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{feature.tooltip}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <SpeedRating rating={model.speed} />
                            </TableCell>
                            <TableCell>
                              <AccuracyRating rating={model.accuracy} />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-center space-y-1">
                                {/* API models show key icon with status */}
                                {isApiModel && (
                                  <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                      hasApiKey
                                        ? "bg-green-500/10"
                                        : "bg-muted"
                                    }`}
                                    title={
                                      hasApiKey
                                        ? "API key configured"
                                        : "API key required - configure in provider settings above"
                                    }
                                  >
                                    <Key
                                      className={`w-4 h-4 ${
                                        hasApiKey
                                          ? "text-green-500"
                                          : "text-muted-foreground"
                                      }`}
                                    />
                                  </div>
                                )}

                                {/* Offline models show download/delete buttons */}
                                {isOfflineModel &&
                                  !isDownloaded &&
                                  !isDownloading && (
                                    <button
                                      onClick={(e) =>
                                        handleDownload(model.id, e)
                                      }
                                      className="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-primary-foreground transition-colors"
                                      title="Click to download"
                                    >
                                      <Download className="w-4 h-4 text-muted-foreground" />
                                    </button>
                                  )}

                                {isOfflineModel &&
                                  !isDownloaded &&
                                  isDownloading && (
                                    <div className="relative">
                                      <button
                                        type="button"
                                        onClick={(e) =>
                                          handleCancelDownload(model.id, e)
                                        }
                                        className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors"
                                        title="Click to cancel download"
                                        aria-label={`Cancel downloading ${model.name}`}
                                      >
                                        <Square className="w-4 h-4" />
                                      </button>

                                      {/* Circular Progress Ring */}
                                      {progress && (
                                        <svg
                                          className="absolute inset-0 w-8 h-8 -rotate-90 pointer-events-none"
                                          viewBox="0 0 36 36"
                                        >
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="15.9155"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                            strokeDasharray="100 100"
                                            className="text-muted-foreground/30"
                                          />
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="15.9155"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                            strokeDasharray={`${Math.max(0, Math.min(100, progress.progress))} 100`}
                                            strokeLinecap="round"
                                            className="text-white transition-all duration-300"
                                          />
                                        </svg>
                                      )}
                                    </div>
                                  )}

                                {isOfflineModel && isDownloaded && (
                                  <button
                                    type="button"
                                    onClick={(e) =>
                                      handleDeleteClick(model.id, e)
                                    }
                                    className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
                                    title="Click to delete model"
                                    aria-label={`Delete ${model.name}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}

                                <div className="text-xs text-muted-foreground text-center">
                                  {isOfflineModel
                                    ? model.sizeFormatted
                                    : "API"}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </RadioGroup>
              </TooltipProvider>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this model? This action cannot be
              undone and you will need to download the model again if you want
              to use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
