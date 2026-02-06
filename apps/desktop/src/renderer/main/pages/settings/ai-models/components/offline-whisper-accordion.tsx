"use client";

import { useEffect, useMemo, useState } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import type { DownloadProgress } from "@/constants/models";

const PROVIDER_NAME = "Whisper (Offline)";
const PROVIDER_ICON = "/icons/models/pc.svg";
const PROVIDER_FRAME_CLASS = "bg-white border-slate-200";
const PROVIDER_FALLBACK_CLASS = "text-slate-900";

export default function OfflineWhisperAccordion() {
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, DownloadProgress>
  >({});
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);
  const [showDeleteId, setShowDeleteId] = useState<string | null>(null);

  const utils = api.useUtils();

  const availableModelsQuery = api.models.getAvailableModels.useQuery();
  const downloadedModelsQuery = api.models.getDownloadedModels.useQuery();
  const activeDownloadsQuery = api.models.getActiveDownloads.useQuery();

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
      setModelToDelete(null);
      setShowDeleteId(null);
    },
    onError: (error) => {
      console.error("Failed to delete model:", error);
      toast.error("Failed to delete model");
      setModelToDelete(null);
      setShowDeleteId(null);
    },
  });

  useEffect(() => {
    if (activeDownloadsQuery.data) {
      const progressMap: Record<string, DownloadProgress> = {};
      activeDownloadsQuery.data.forEach((download) => {
        progressMap[download.modelId] = download;
      });
      setDownloadProgress(progressMap);
    }
  }, [activeDownloadsQuery.data]);

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
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      utils.models.getDownloadedModels.invalidate();
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Download complete subscription error:", error);
    },
  });

  api.models.onDownloadError.useSubscription(undefined, {
    onData: ({ modelId, error }) => {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
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
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error("Download cancelled subscription error:", error);
    },
  });

  const offlineModels = useMemo(() => {
    const models = availableModelsQuery.data ?? [];
    return models.filter((model) => model.setup === "offline");
  }, [availableModelsQuery.data]);

  const downloadedModels = downloadedModelsQuery.data ?? {};
  const isLoading =
    availableModelsQuery.isLoading || downloadedModelsQuery.isLoading;

  const handleDownload = async (modelId: string) => {
    try {
      await downloadModelMutation.mutateAsync({ modelId });
    } catch (err) {
      console.error("Failed to start download:", err);
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      await cancelDownloadMutation.mutateAsync({ modelId });
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  };

  const handleDelete = async (modelId: string) => {
    setModelToDelete(modelId);
    setShowDeleteId(modelId);
  };

  const confirmDelete = async () => {
    if (!modelToDelete) return;
    try {
      await deleteModelMutation.mutateAsync({ modelId: modelToDelete });
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  const cancelDelete = () => {
    setModelToDelete(null);
    setShowDeleteId(null);
  };

  return (
    <AccordionItem
      value="wisper-offline"
      className="rounded-lg border border-border bg-muted/30 px-4 py-2 data-[state=open]:bg-muted/40"
    >
      <AccordionTrigger className="py-2 no-underline hover:no-underline group-hover:no-underline">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Avatar
                className={`h-7 w-7 rounded-md border ${PROVIDER_FRAME_CLASS}`}
              >
                <AvatarImage
                  src={PROVIDER_ICON}
                  alt={`${PROVIDER_NAME} logo`}
                  className="object-contain p-0.5"
                />
                <AvatarFallback
                  className={`rounded-md text-[10px] font-semibold ${PROVIDER_FALLBACK_CLASS}`}
                >
                  WO
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-semibold">{PROVIDER_NAME}</span>
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 tracking-wide"
                >
                  Speech-to-Text
                </Badge>
              </div>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="text-xs flex items-center gap-1 text-green-500 border-green-500"
          >
            <span className="w-2 h-2 rounded-full inline-block bg-green-500 mr-1" />
            Available
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-1">
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">
            Speech models
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading models...
          </div>
        ) : offlineModels.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No offline models available.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {offlineModels.map((model) => {
              const isDownloaded = !!downloadedModels[model.id];
              const progress = downloadProgress[model.id];
              const isDownloading = progress?.status === "downloading";
              const progressValue =
                typeof progress?.progress === "number"
                  ? Math.round(progress.progress)
                  : 0;

              return (
                <div
                  key={model.id}
                  className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium">{model.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {model.sizeFormatted}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isDownloading && (
                      <span className="text-xs text-muted-foreground">
                        {progressValue}%
                      </span>
                    )}
                    {!isDownloaded && !isDownloading && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownload(model.id)}
                        aria-label="Download"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    {isDownloading && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleCancelDownload(model.id)}
                        aria-label="Cancel download"
                        title="Cancel download"
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    )}
                    {isDownloaded && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(model.id)}
                        aria-label="Delete model"
                        title="Delete model"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showDeleteId && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-destructive">
                Delete this model? You can re-download it anytime.
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={cancelDelete}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" onClick={confirmDelete}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
