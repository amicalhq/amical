"use client";
import { ComponentProps, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import DefaultModelCombobox from "../components/default-model-combobox";
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
  LogIn,
  Cloud,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DownloadProgress } from "@/constants/models";
import { Accordion } from "@/components/ui/accordion";
import ProviderAccordion from "../components/provider-accordion";
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
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [pendingCloudModel, setPendingCloudModel] = useState<string | null>(
    null,
  );
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | undefined>(
    undefined,
  );

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
      if (variables.modelId === "amical-cloud") {
        toast.success("Amical Cloud selected. Cloud formatting enabled.");
      }
    },
    onError: (error) => {
      console.error("Failed to select model:", error);
      toast.error("Failed to select model");
    },
  });

  // Auth mutations
  const loginMutation = api.auth.login.useMutation({
    onSuccess: () => {
      toast.info("Please complete login in your browser");
    },
    onError: (error) => {
      console.error("Failed to initiate login:", error);
      toast.error("Failed to start login process");
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

  // Auth state subscription - update auth state and handle pending cloud model selection
  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (authState) => {
      setIsAuthenticated(authState.isAuthenticated);

      if (authState.isAuthenticated && pendingCloudModel) {
        toast.success("Login successful!");
        setSelectedModelMutation.mutate({ modelId: pendingCloudModel });
        setPendingCloudModel(null);
      }
    },
    onError: (error) => {
      console.error("Auth state subscription error:", error);
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

    // If cloud model and not authenticated, show login dialog
    if (model?.setup === "amical" && !isAuthenticated) {
      setPendingCloudModel(modelId);
      setShowLoginDialog(true);
      return;
    }

    // If API model without configured API key, show guidance
    if (model?.setup === "api") {
      const hasKey =
        (model.provider === "OpenAI" && apiKeyStatus.openAI) ||
        (model.provider === "Groq" && apiKeyStatus.groq) ||
        (model.provider === "Grok" && apiKeyStatus.grok);
      if (!hasKey) {
        toast.error(
          `Please configure your ${model.provider} API key in the Transcription API Providers section above.`,
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

  const handleLogin = async () => {
    try {
      await loginMutation.mutateAsync();
      setShowLoginDialog(false);
      toast.info("Complete login in your browser");
      // Auth state subscription will handle the rest when login completes
    } catch (err) {
      console.error("Failed to login:", err);
      toast.error("Failed to start login");
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
          {/* Default model picker using unified component */}
          <DefaultModelCombobox
            modelType="speech"
            title="Default Speech Model"
          />

          {/* Transcription API Providers */}
          <div>
            <Label className="text-lg font-semibold mb-2 block">
              Transcription API Providers
            </Label>
            <Accordion type="multiple" className="w-full">
              <ProviderAccordion provider="OpenAI" modelType="transcription" />
              <ProviderAccordion provider="Groq" modelType="transcription" />
              <ProviderAccordion provider="Grok" modelType="transcription" />
            </Accordion>
          </div>

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
                      {availableModels.map((model) => {
                        const isDownloaded = !!downloadedModels[model.id];
                        const progress = downloadProgress[model.id];
                        const isDownloading =
                          progress?.status === "downloading";
                        const isCloudModel = model.setup === "amical";
                        const isApiModel = model.setup === "api";
                        const isOfflineModel = model.setup === "offline";

                        // Check if API model's provider has API key configured
                        const hasApiKey = isApiModel
                          ? (model.provider === "OpenAI" && apiKeyStatus.openAI) ||
                            (model.provider === "Groq" && apiKeyStatus.groq) ||
                            (model.provider === "Grok" && apiKeyStatus.grok)
                          : false;

                        // Selection logic based on model setup type
                        const canSelect = isCloudModel
                          ? (isAuthenticated ?? false)
                          : isApiModel
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
                                  {isCloudModel && (
                                    <div className="mt-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Badge
                                            variant="secondary"
                                            className="text-[10px] px-1.5 py-0"
                                          >
                                            Formatting available
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Cloud formatting is available when
                                          this model is selected.
                                        </TooltipContent>
                                      </Tooltip>
                                    </div>
                                  )}
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
                                {/* Cloud models show cloud icon or login button */}
                                {isCloudModel && (
                                  <>
                                    {isAuthenticated ? (
                                      <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                                        <Cloud className="w-4 h-4 text-blue-500" />
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setShowLoginDialog(true)}
                                        className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center text-white transition-colors"
                                        title="Sign in to use cloud model"
                                      >
                                        <LogIn className="w-4 h-4" />
                                      </button>
                                    )}
                                  </>
                                )}

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
                                    : isApiModel
                                      ? "API"
                                      : "Cloud"}
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

      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign In Required</DialogTitle>
            <DialogDescription>
              To use Amical Cloud transcription, you need to sign in with your
              Amical account. This enables secure cloud-based transcription with
              high accuracy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              After clicking "Sign In", you'll be redirected to your browser to
              complete the login process.
            </p>
            <div className="flex items-center space-x-2 text-sm">
              <Cloud className="w-4 h-4 text-blue-500" />
              <span>Fast, accurate cloud transcription</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoginDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleLogin} disabled={loginMutation.isPending}>
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Opening Browser...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign In
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
