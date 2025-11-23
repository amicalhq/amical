import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Download, AlertCircle, Check } from "lucide-react";
import { api } from "@/trpc/react";
import { ModelType } from "../../../../types/onboarding";
import { toast } from "sonner";

interface ModelSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelType: ModelType;
  onSetupComplete: () => void;
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
  onSetupComplete,
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

  // tRPC mutations and utils
  const utils = api.useUtils();
  const loginMutation = api.auth.login.useMutation({
    onSuccess: async () => {
      // After login, check auth status
      const authStatus = await utils.auth.getAuthStatus.fetch();
      if (authStatus.isAuthenticated) {
        toast.success("Successfully authenticated!");
        onSetupComplete();
        onClose();
      } else {
        setError("Authentication failed. Please try again.");
      }
      setIsLoading(false);
    },
    onError: (err) => {
      console.error("OAuth error:", err);
      setError("Failed to authenticate. Please try again.");
      setIsLoading(false);
    },
  });
  const downloadModelMutation = api.models.downloadModel.useMutation();

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
      if (data.modelId === "whisper-tiny") {
        setDownloadProgress(data.progress.progress);
        setDownloadInfo({
          downloaded: data.progress.bytesDownloaded || 0,
          total: data.progress.totalBytes || 0,
          speed: undefined, // Speed not available in the current API
        });

        if (data.progress.progress === 100) {
          onSetupComplete();
          onClose();
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
        modelId: "whisper-tiny",
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
        // Model already exists, mark as complete
        setModelAlreadyInstalled(true);
        setInstalledModelName(whisperModels[0].name || whisperModels[0].id);
        onSetupComplete();
        // Don't close immediately to show the success state
        setTimeout(() => {
          onClose();
        }, 2000);
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
            <DialogTitle>Sign in to Amical</DialogTitle>
            <DialogDescription>
              Sign in with your Amical account to use cloud transcription
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button
              onClick={handleAmicalLogin}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in to Amical
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <button
                onClick={handleAmicalLogin}
                className="text-primary hover:underline"
              >
                Create one
              </button>
            </p>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground text-center">
                Your audio is processed in real-time and never stored on our
                servers.
              </p>
            </div>
          </div>
        </>
      );
    }

    // Local model download
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {modelAlreadyInstalled
              ? "Local Model Ready"
              : "Downloading Local Model"}
          </DialogTitle>
          <DialogDescription>
            {modelAlreadyInstalled
              ? "Your system already has a Whisper model installed"
              : "Setting up Whisper Tiny for private, offline transcription"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {modelAlreadyInstalled ? (
            // Show success state when model is already installed
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="rounded-full bg-green-500/10 p-3">
                <Check className="h-6 w-6 text-green-500" />
              </div>
              <div className="text-center">
                <p className="font-medium">Model Already Installed</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Using: {installedModelName}
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

              {downloadProgress < 100 && (
                <Button onClick={onClose} variant="outline" className="w-full">
                  Cancel Download
                </Button>
              )}
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">{renderContent()}</DialogContent>
    </Dialog>
  );
}
