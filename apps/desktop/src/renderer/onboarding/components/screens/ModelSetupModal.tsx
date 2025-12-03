import React, { useEffect, useState } from "react";
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
import { Loader2, Download, AlertCircle, Check } from "lucide-react";
import { api } from "@/trpc/react";
import { ModelType } from "../../../../types/onboarding";
import { toast } from "sonner";

interface ModelSetupModalProps {
  isOpen: boolean;
  onClose: (wasCompleted?: boolean) => void;
  modelType: ModelType;
  onContinue: () => void; // Called when setup completes - auto-advances to next step
}

/**
 * Modal for setting up model-specific requirements
 * Cloud: OAuth authentication
 * Local: Model download
 */
export function ModelSetupModal({
  isOpen,
  onClose,
  modelType,
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

  // Get recommended local model based on hardware
  const { data: recommendedModelId = "whisper-base" } =
    api.onboarding.getRecommendedLocalModel.useQuery(undefined, {
      enabled: modelType === ModelType.Local && isOpen,
    });

  // tRPC mutations
  const loginMutation = api.auth.login.useMutation({
    onSuccess: () => {
      // Browser opened, waiting for OAuth completion via subscription
      toast.info("Complete login in your browser");
    },
    onError: (err) => {
      console.error("OAuth error:", err);
      setError("Failed to open login. Please try again.");
      setIsLoading(false);
    },
  });
  const downloadModelMutation = api.models.downloadModel.useMutation();

  // Subscribe to auth state changes for Cloud model OAuth completion
  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (authState) => {
      if (authState.isAuthenticated && isLoading) {
        toast.success("Successfully authenticated!");
        setIsLoading(false);
        onContinue();
      }
    },
    onError: (error) => {
      console.error("Auth state subscription error:", error);
    },
    enabled: modelType === ModelType.Cloud && isOpen,
  });

  // Check for existing downloaded models
  const { data: downloadedModels } = api.models.getDownloadedModels.useQuery(
    undefined,
    {
      enabled: modelType === ModelType.Local && isOpen,
    },
  );

  // Subscribe to download progress
  api.models.onDownloadProgress.useSubscription(undefined, {
    onData: (data) => {
      if (data.modelId === recommendedModelId) {
        setDownloadProgress(data.progress.progress);
        setDownloadInfo({
          downloaded: data.progress.bytesDownloaded || 0,
          total: data.progress.totalBytes || 0,
          speed: undefined, // Speed not available in the current API
        });

        if (data.progress.progress === 100) {
          setDownloadComplete(true);
        }
      }
    },
    enabled: modelType === ModelType.Local && isOpen,
  });

  // Handle Amical authentication
  const handleAmicalLogin = async () => {
    setIsLoading(true);
    setError(null);

    // The login mutation triggers Amical OAuth flow via the main process
    loginMutation.mutate();
  };

  // Handle model download
  const startDownload = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await downloadModelMutation.mutateAsync({
        modelId: recommendedModelId,
      });
      // Progress will be handled by subscription
    } catch (err) {
      console.error("Download error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to download model: ${errorMessage}`);
      setIsLoading(false);
    }
  };

  // Auto-start download for local models or check if already installed
  useEffect(() => {
    if (isOpen && modelType === ModelType.Local && downloadedModels) {
      // Check if any whisper model is already downloaded
      const whisperModels = Object.values(downloadedModels).filter(
        (model) => model.id && model.id.startsWith("whisper-"),
      );

      if (whisperModels.length > 0) {
        // Model already exists - user must click Done to confirm
        setModelAlreadyInstalled(true);
        setInstalledModelName(whisperModels[0].name || whisperModels[0].id);
      } else if (!isLoading && !downloadProgress) {
        // No existing model, start download
        startDownload();
      }
    }
  }, [isOpen, modelType, downloadedModels]);

  // Format bytes to MB
  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Render content based on model type
  const renderContent = () => {
    if (modelType === ModelType.Cloud) {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Sign in required</DialogTitle>
            <DialogDescription>
              Cloud transcription needs authentication to continue.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="space-x-2">
            <Button variant="outline" onClick={() => onClose(false)}>
              Cancel
            </Button>
            <Button onClick={handleAmicalLogin} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
          </DialogFooter>
        </>
      );
    }

    // Local model download
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {modelAlreadyInstalled || downloadComplete
              ? "Local Model Ready"
              : "Downloading Local Model"}
          </DialogTitle>
          <DialogDescription>
            {modelAlreadyInstalled || downloadComplete
              ? "Ready for private, offline transcription."
              : "Setting up local model for private, offline transcription"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
                  Using: {installedModelName || recommendedModelId}
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
          ) : (
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
          )}
        </div>

        <DialogFooter className="space-x-2">
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={onContinue}
            disabled={!modelAlreadyInstalled && !downloadComplete}
          >
            Continue
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
