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
import { api } from "@/trpc/react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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

  const utils = api.useUtils();

  // tRPC mutations
  const downloadModelMutation = api.models.downloadModel.useMutation({
    onSuccess: () => {
      utils.models.getDownloadedModels.invalidate();
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Failed to start download:", error);
      toast.error(t("settings.aiModels.speech.toast.downloadStartFailed"));
    },
  });

  const cancelDownloadMutation = api.models.cancelDownload.useMutation({
    onSuccess: () => {
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Failed to cancel download:", error);
      toast.error(t("settings.aiModels.speech.toast.downloadCancelFailed"));
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
      toast.error(t("settings.aiModels.speech.toast.deleteFailed"));
      setShowDeleteDialog(false);
      setModelToDelete(null);
    },
  });

  const setSelectedModelMutation = api.models.setSelectedModel.useMutation({
    onSuccess: (_data, variables) => {
      utils.models.getSelectedModel.invalidate();
      if (variables.modelId === "amical-cloud") {
        toast.success(t("settings.aiModels.speech.toast.cloudSelected"));
      }
    },
    onError: (error) => {
      console.error("Failed to select model:", error);
      toast.error(t("settings.aiModels.speech.toast.selectFailed"));
    },
  });

  // Auth mutations
  const loginMutation = api.auth.login.useMutation({
    onSuccess: () => {
      toast.info(t("settings.aiModels.speech.toast.loginInBrowser"));
    },
    onError: (error) => {
      console.error("Failed to initiate login:", error);
      toast.error(t("settings.aiModels.speech.toast.loginStartFailed"));
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
      toast.error(
        t("settings.aiModels.speech.toast.downloadFailed", { message: error }),
      );
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
        toast.success(t("settings.aiModels.speech.toast.loginSuccess"));
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
    // Check if this is a cloud model
    const model = availableModels.find((m) => m.id === modelId);
    const isCloudModel = model?.provider === "Amical Cloud";

    // If cloud model and not authenticated, show login dialog
    if (isCloudModel && !isAuthenticated) {
      setPendingCloudModel(modelId);
      setShowLoginDialog(true);
      return;
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
      toast.info(t("settings.aiModels.speech.toast.loginInBrowser"));
      // Auth state subscription will handle the rest when login completes
    } catch (err) {
      console.error("Failed to login:", err);
      toast.error(t("settings.aiModels.speech.toast.loginStartFailed"));
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-2">{t("settings.aiModels.speech.loading")}</span>
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
            title={t("settings.aiModels.defaultModels.speech")}
          />
          <div>
            <Label className="text-lg font-semibold mb-2 block">
              {t("settings.aiModels.speech.availableModels")}
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
                        <TableHead>
                          {t("settings.aiModels.speech.table.model")}
                        </TableHead>
                        <TableHead>
                          {t("settings.aiModels.speech.table.features")}
                        </TableHead>
                        <TableHead>
                          {t("settings.aiModels.speech.table.speed")}
                        </TableHead>
                        <TableHead>
                          {t("settings.aiModels.speech.table.accuracy")}
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availableModels.map((model) => {
                        const isDownloaded = !!downloadedModels[model.id];
                        const progress = downloadProgress[model.id];
                        const isDownloading =
                          progress?.status === "downloading";
                        const isCloudModel = model.provider === "Amical Cloud";

                        // Cloud models can be selected if authenticated, local models need to be downloaded
                        const canSelect = isCloudModel
                          ? (isAuthenticated ?? false)
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
                                        alt={t(
                                          "settings.aiModels.speech.providerIconAlt",
                                          { provider: model.provider },
                                        )}
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
                                            {t(
                                              "settings.aiModels.speech.cloudFormatting.badge",
                                            )}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {t(
                                            "settings.aiModels.speech.cloudFormatting.tooltip",
                                          )}
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
                                        title={t(
                                          "settings.aiModels.speech.cloudFormatting.signInTitle",
                                        )}
                                      >
                                        <LogIn className="w-4 h-4" />
                                      </button>
                                    )}
                                  </>
                                )}

                                {/* Local models show download/delete buttons */}
                                {!isCloudModel &&
                                  !isDownloaded &&
                                  !isDownloading && (
                                    <button
                                      onClick={(e) =>
                                        handleDownload(model.id, e)
                                      }
                                      className="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-primary-foreground transition-colors"
                                      title={t(
                                        "settings.aiModels.speech.actions.downloadTitle",
                                      )}
                                    >
                                      <Download className="w-4 h-4 text-muted-foreground" />
                                    </button>
                                  )}

                                {!isCloudModel &&
                                  !isDownloaded &&
                                  isDownloading && (
                                    <div className="relative">
                                      <button
                                        type="button"
                                        onClick={(e) =>
                                          handleCancelDownload(model.id, e)
                                        }
                                        className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors"
                                        title={t(
                                          "settings.aiModels.speech.actions.cancelDownloadTitle",
                                        )}
                                        aria-label={t(
                                          "settings.aiModels.speech.actions.cancelDownloadAria",
                                          { modelName: model.name },
                                        )}
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

                                {!isCloudModel && isDownloaded && (
                                  <button
                                    type="button"
                                    onClick={(e) =>
                                      handleDeleteClick(model.id, e)
                                    }
                                    className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
                                    title={t(
                                      "settings.aiModels.speech.actions.deleteTitle",
                                    )}
                                    aria-label={t(
                                      "settings.aiModels.speech.actions.deleteAria",
                                      { modelName: model.name },
                                    )}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}

                                <div className="text-xs text-muted-foreground text-center">
                                  {model.sizeFormatted}
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
            <AlertDialogTitle>
              {t("settings.aiModels.speech.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.aiModels.speech.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>
              {t("settings.aiModels.speech.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-500 hover:bg-red-600"
            >
              {t("settings.aiModels.speech.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.aiModels.speech.loginDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.aiModels.speech.loginDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.aiModels.speech.loginDialog.browserNotice")}
            </p>
            <div className="flex items-center space-x-2 text-sm">
              <Cloud className="w-4 h-4 text-blue-500" />
              <span>
                {t("settings.aiModels.speech.loginDialog.cloudBenefit")}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoginDialog(false)}>
              {t("settings.aiModels.speech.loginDialog.cancel")}
            </Button>
            <Button onClick={handleLogin} disabled={loginMutation.isPending}>
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("settings.aiModels.speech.loginDialog.openingBrowser")}
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  {t("settings.aiModels.speech.loginDialog.signIn")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
