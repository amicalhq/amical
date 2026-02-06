import React, { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ModelType } from "../../../../types/onboarding";
import { Check, Star, Download, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import type { DownloadProgress } from "@/constants/models";

interface ModelSelectionScreenProps {
  onNext: (modelType: ModelType, recommendationFollowed: boolean) => void;
  onBack: () => void;
  initialSelection?: ModelType;
}

/**
 * Model selection screen - local model setup
 */
export function ModelSelectionScreen({
  onNext,
  onBack,
  initialSelection,
}: ModelSelectionScreenProps) {
  const PROVIDER_ICON = "/icons/models/pc.svg";
  const PROVIDER_FRAME_CLASS = "bg-white border-slate-200";
  const PROVIDER_FALLBACK_CLASS = "text-slate-900";

  const [selectedModel, setSelectedModel] = useState<ModelType>(
    initialSelection ?? ModelType.Local,
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, DownloadProgress>
  >({});
  const [error, setError] = useState<string | null>(null);

  const models = [
    {
      id: ModelType.Local,
      title: "Whisper (Offline)",
      subtitle: "Private, offline transcription running on your device.",
    },
  ];

  const availableModelsQuery = api.models.getAvailableModels.useQuery();
  const downloadedModelsQuery = api.models.getDownloadedModels.useQuery();
  const activeDownloadsQuery = api.models.getActiveDownloads.useQuery();
  const downloadModelMutation = api.models.downloadModel.useMutation();
  const setSelectedModelMutation = api.models.setSelectedModel.useMutation();
  const utils = api.useUtils();

  const offlineModels = useMemo(() => {
    return (availableModelsQuery.data || []).filter(
      (model) => model.setup === "offline",
    );
  }, [availableModelsQuery.data]);

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
  });

  api.models.onDownloadError.useSubscription(undefined, {
    onData: ({ modelId, error: message }) => {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      setError(message || "Download failed");
      utils.models.getActiveDownloads.invalidate();
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
  });

  const handleModelSelect = (modelId: ModelType) => {
    setSelectedModel(modelId);
  };

  useEffect(() => {
    if (selectedModelId || offlineModels.length === 0) return;
    const recommendedId = "whisper-large-v3-turbo";
    const defaultId = offlineModels.some((model) => model.id === recommendedId)
      ? recommendedId
      : offlineModels[0].id;
    setSelectedModelId(defaultId);
  }, [offlineModels, selectedModelId]);

  const handleContinue = () => {
    if (!selectedModel) {
      toast.error("Please select a model type");
      return;
    }

    if (!selectedModelId) {
      toast.error("Please select a model");
      return;
    }

    const downloaded = downloadedModelsQuery.data?.[selectedModelId];
    if (!downloaded) {
      toast.error("Please download the selected model");
      return;
    }

    setSelectedModelMutation.mutate(
      { modelId: selectedModelId },
      {
        onSuccess: () => {
          onNext(ModelType.Local, true);
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(`Failed to select model: ${message}`);
        },
      },
    );
  };

  const canContinue =
    selectedModelId &&
    Boolean(downloadedModelsQuery.data?.[selectedModelId]);

  return (
    <OnboardingLayout
      title="Set Up Speech-to-Text"
      subtitle="Download a Whisper model to enable offline transcription"
      footer={
        <NavigationButtons
          onBack={onBack}
          onNext={handleContinue}
          disableNext={!canContinue}
          nextLabel={canContinue ? "Continue" : "Download a model to continue"}
        />
      }
    >
      <div className="space-y-4">
        {/* Model Option */}
        <div className="space-y-4">
          {models.map((model) => {
            const isSelected = selectedModel === model.id;

            return (
              <Card
                key={model.id}
                className={`cursor-pointer transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/50"
                }`}
                onClick={() => handleModelSelect(model.id)}
              >
                <div className="flex items-start gap-4 px-4">
                  <div className="flex-1 space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar
                          className={`h-9 w-9 rounded-md border ${PROVIDER_FRAME_CLASS}`}
                        >
                          <AvatarImage
                            src={PROVIDER_ICON}
                            alt={`${model.title} logo`}
                            className="object-contain p-0.5"
                          />
                          <AvatarFallback
                            className={`rounded-md text-[10px] font-semibold ${PROVIDER_FALLBACK_CLASS}`}
                          >
                            WO
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{model.title}</h3>
                          </div>
                          <p className="text-sm">{model.subtitle}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Offline Model List */}
        <div className="space-y-2">
          {offlineModels.map((model) => {
            const isRecommended = model.id === "whisper-large-v3-turbo";
            const isSelected = selectedModelId === model.id;
            const progress = downloadProgress[model.id];
            const downloaded = Boolean(downloadedModelsQuery.data?.[model.id]);

            return (
              <div
                key={model.id}
                className={`rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                }`}
                onClick={() => setSelectedModelId(model.id)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{model.name}</p>
                      {isRecommended && (
                        <Badge variant="secondary" className="text-xs">
                          Recommended
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {model.sizeFormatted || model.modelSize || ""}
                    </p>
                  </div>

                  {downloaded ? (
                    <div className="flex items-center gap-1 text-sm text-green-600">
                      <Check className="h-4 w-4" />
                      Downloaded
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedModelId(model.id);
                        setError(null);
                        downloadModelMutation
                          .mutateAsync({ modelId: model.id })
                          .catch((err) => {
                            const message =
                              err instanceof Error ? err.message : String(err);
                            setError(message);
                          });
                      }}
                      disabled={Boolean(progress)}
                    >
                      {progress ? "Downloading..." : "Download"}
                    </Button>
                  )}
                </div>

                {progress && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <Download className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <Progress value={progress.progress} className="h-2" />
                      </div>
                      <span className="text-xs font-medium">
                        {progress.progress}%
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(progress.bytesDownloaded / (1024 * 1024)).toFixed(1)} /
                      {(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Settings Note */}
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-4">
          <Star className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0 " />
          <p className="text-sm text-muted-foreground">
            You can change your model later in Settings — nothing is permanent.
          </p>
        </div>
      </div>
    </OnboardingLayout>
  );
}
