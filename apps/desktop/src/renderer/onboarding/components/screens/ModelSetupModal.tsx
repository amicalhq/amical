import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, AlertCircle, Check } from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";

interface ModelSetupModalProps {
  isOpen: boolean;
  onClose: (wasCompleted?: boolean) => void;
  onContinue: () => void; // Called when setup completes - auto-advances to next step
}

/**
 * Modal for setting up local model requirements
 */
export function ModelSetupModal({
  isOpen,
  onClose,
  onContinue,
}: ModelSetupModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadInfo, setDownloadInfo] = useState<{
    downloaded: number;
    total: number;
    speed?: number;
  } | null>(null);
  const [modelAlreadyInstalled, setModelAlreadyInstalled] = useState(false);
  const [installedModelName, setInstalledModelName] = useState<string>("");
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Get recommended local model based on hardware
  const { data: recommendedModelId = "whisper-base" } =
    api.onboarding.getRecommendedLocalModel.useQuery(undefined, {
      enabled: isOpen,
    });

  const availableModelsQuery = api.models.getAvailableModels.useQuery(
    undefined,
    { enabled: isOpen },
  );

  const offlineModels = useMemo(() => {
    return (availableModelsQuery.data || []).filter(
      (model) => model.setup === "offline",
    );
  }, [availableModelsQuery.data]);

  // tRPC mutations
  const downloadModelMutation = api.models.downloadModel.useMutation();
  const setSelectedModelMutation = api.models.setSelectedModel.useMutation();

  // Check for existing downloaded models
  const { data: downloadedModels } = api.models.getDownloadedModels.useQuery(
    undefined,
    { enabled: isOpen },
  );

  // Subscribe to download progress
  api.models.onDownloadProgress.useSubscription(undefined, {
    onData: (data) => {
      if (!selectedModelId || data.modelId !== selectedModelId) return;
      setDownloadProgress(data.progress.progress);
      setDownloadInfo({
        downloaded: data.progress.bytesDownloaded || 0,
        total: data.progress.totalBytes || 0,
        speed: undefined, // Speed not available in the current API
      });

      if (data.progress.progress === 100) {
        setDownloadComplete(true);
        setIsLoading(false);
      }
    },
    enabled: isOpen,
  });

  // Handle model download
  const startDownload = async () => {
    if (!selectedModelId) {
      toast.error("Please select a model");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      await downloadModelMutation.mutateAsync({
        modelId: selectedModelId,
      });
      // Progress will be handled by subscription
    } catch (err) {
      console.error("Download error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to download model: ${errorMessage}`);
      setIsLoading(false);
    }
  };

  // Initialize selected model
  useEffect(() => {
    if (!isOpen || selectedModelId || offlineModels.length === 0) return;
    const recommendedExists = offlineModels.some(
      (model) => model.id === recommendedModelId,
    );
    setSelectedModelId(
      recommendedExists ? recommendedModelId : offlineModels[0].id,
    );
  }, [isOpen, offlineModels, recommendedModelId, selectedModelId]);

  // Update installed status when selection changes
  useEffect(() => {
    if (!isOpen || !selectedModelId) return;
    const downloaded = downloadedModels?.[selectedModelId];
    if (downloaded) {
      setModelAlreadyInstalled(true);
      setInstalledModelName(downloaded.name || downloaded.id);
      setDownloadComplete(true);
      setError(null);
      setIsLoading(false);
    } else {
      setModelAlreadyInstalled(false);
      setInstalledModelName("");
      setDownloadComplete(false);
      setDownloadProgress(0);
      setDownloadInfo(null);
      setError(null);
    }
  }, [downloadedModels, isOpen, selectedModelId]);

  // No auto-download; user explicitly starts download.

  // Format bytes to MB
  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleContinue = async () => {
    if (!selectedModelId) {
      toast.error("Please select a model");
      return;
    }
    try {
      await setSelectedModelMutation.mutateAsync({
        modelId: selectedModelId,
      });
      onContinue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to select model: ${message}`);
    }
  };

  const renderContent = () => {
    const isDownloading = isLoading || downloadProgress > 0;
    // Local model download
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {modelAlreadyInstalled || downloadComplete
              ? "Whisper Model Ready"
              : "Download Whisper Model"}
          </DialogTitle>
          <DialogDescription>
            {modelAlreadyInstalled || downloadComplete
              ? "Ready for private, offline transcription."
              : "Select a model and download it to continue."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            {offlineModels.map((model) => {
              const isSelected = selectedModelId === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setSelectedModelId(model.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{model.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {model.sizeFormatted || model.modelSize || ""}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="rounded-full bg-green-500/10 p-1">
                        <Check className="h-4 w-4 text-green-500" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {modelAlreadyInstalled || downloadComplete ? (
            // Show success state when model is ready
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-full bg-green-500/10 p-3">
                <Check className="h-6 w-6 text-green-500" />
              </div>
              <div className="text-center">
                <p className="font-medium">
                  {modelAlreadyInstalled
                    ? "Model Already Installed"
                    : "Download Complete"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Using: {installedModelName || selectedModelId}
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
              <Button
                onClick={startDownload}
                size="sm"
                variant="outline"
                className="ml-auto"
              >
                Retry
              </Button>
            </div>
          ) : isDownloading ? (
            <>
              <div className="flex items-center gap-3">
                <Download className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <Progress value={downloadProgress} className="h-2" />
                </div>
                <span className="text-sm font-medium">{downloadProgress}%</span>
              </div>

              {downloadInfo && (
                <div className="text-center text-sm text-muted-foreground">
                  {formatBytes(downloadInfo.downloaded)} /{" "}
                  {formatBytes(downloadInfo.total)}
                  {downloadInfo.speed && (
                    <span>
                      {" "}
                      • {(downloadInfo.speed / 1024 / 1024).toFixed(1)} MB/s
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <Download className="h-4 w-4" />
                Select a model above and click Download to begin.
              </div>
            </>
          )}
        </div>

        <DialogFooter className="space-x-2">
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          {!modelAlreadyInstalled && !downloadComplete && (
            <Button
              variant="secondary"
              onClick={startDownload}
              disabled={!selectedModelId || isDownloading}
            >
              {isDownloading ? "Downloading..." : "Download"}
            </Button>
          )}
          <Button
            onClick={handleContinue}
            disabled={!modelAlreadyInstalled && !downloadComplete}
          >
            Next
          </Button>
        </DialogFooter>
      </>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="sm:max-w-md">{renderContent()}</DialogContent>
    </Dialog>
  );
}
