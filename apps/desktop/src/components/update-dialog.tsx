import React, { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Progress } from "./ui/progress";
import { Button } from "./ui/button";
import { Download, RefreshCw, CheckCircle } from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo?: {
    version: string;
    releaseNotes?: string;
  };
}

export function UpdateDialog({
  isOpen,
  onClose,
  updateInfo,
}: UpdateDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // tRPC queries for update status
  const isCheckingQuery = api.updater.isCheckingForUpdate.useQuery(undefined, {
    enabled: isOpen,
    refetchInterval: isOpen ? 1000 : false, // Poll every second when dialog is open
  });
  const isUpdateAvailableQuery = api.updater.isUpdateAvailable.useQuery(
    undefined,
    {
      enabled: isOpen,
      refetchInterval: isOpen ? 1000 : false,
    },
  );

  const utils = api.useUtils();

  // tRPC mutations
  const checkForUpdatesMutation = api.updater.checkForUpdates.useMutation({
    onSuccess: () => {
      toast.success("Update check completed");
      utils.updater.isUpdateAvailable.invalidate();
      utils.updater.isCheckingForUpdate.invalidate();
    },
    onError: (error) => {
      console.error("Error checking for updates:", error);
      toast.error("Failed to check for updates");
    },
  });

  const downloadUpdateMutation = api.updater.downloadUpdate.useMutation({
    onSuccess: () => {
      toast.success("Update download started");
    },
    onError: (error) => {
      console.error("Error downloading update:", error);
      toast.error("Failed to download update");
      setIsDownloading(false);
    },
  });

  const quitAndInstallMutation = api.updater.quitAndInstall.useMutation({
    onError: (error) => {
      console.error("Error installing update:", error);
      toast.error("Failed to install update");
    },
  });

  // Get status from queries
  const isCheckingForUpdates = isCheckingQuery.data || false;
  const updateAvailable = isUpdateAvailableQuery.data || false;

  // Subscribe to download progress via tRPC
  api.updater.onDownloadProgress.useSubscription(undefined, {
    enabled: isOpen && isDownloading,
    onData: (progress) => {
      setDownloadProgress(Math.round(progress.percent || 0));
    },
    onError: (error) => {
      console.error("Download progress subscription error:", error);
    },
  });

  const handleCheckForUpdates = async () => {
    checkForUpdatesMutation.mutate({ userInitiated: true });
  };

  const handleDownloadUpdate = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    downloadUpdateMutation.mutate();
  };

  const handleInstallUpdate = async () => {
    quitAndInstallMutation.mutate();
  };

  if (!updateAvailable && !isCheckingForUpdates && !isDownloading) {
    return (
      <AlertDialog open={isOpen} onOpenChange={onClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Check for Updates
            </AlertDialogTitle>
            <AlertDialogDescription>
              Click below to check for the latest version of Grizzo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCheckForUpdates}>
              Check for Updates
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (isCheckingForUpdates) {
    return (
      <AlertDialog open={isOpen} onOpenChange={onClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin" />
              Checking for Updates...
            </AlertDialogTitle>
            <AlertDialogDescription>
              Please wait while we check for the latest version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (isDownloading) {
    return (
      <AlertDialog open={isOpen} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Downloading Update...
            </AlertDialogTitle>
            <AlertDialogDescription>
              {updateInfo?.version && (
                <>Downloading version {updateInfo.version}. Please wait...</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Progress value={downloadProgress} className="w-full" />
            <p className="text-sm text-muted-foreground mt-2 text-center">
              {downloadProgress}% complete
            </p>
          </div>
          <AlertDialogFooter>
            <Button variant="outline" disabled>
              Downloading...
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (downloadProgress === 100 && !isDownloading) {
    return (
      <AlertDialog open={isOpen} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Update Ready
            </AlertDialogTitle>
            <AlertDialogDescription>
              {updateInfo?.version && (
                <>
                  Version {updateInfo.version} has been downloaded and is ready
                  to install. The app will restart to complete the installation.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onClose}>
              Install Later
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleInstallUpdate}>
              Restart & Install
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Update Available
          </AlertDialogTitle>
          <AlertDialogDescription>
            {updateInfo?.version && (
              <>
                A new version ({updateInfo.version}) is available for download.
                {updateInfo.releaseNotes && (
                  <div className="mt-2 p-2 bg-muted rounded text-sm">
                    {updateInfo.releaseNotes}
                  </div>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Later</AlertDialogCancel>
          <AlertDialogAction onClick={handleDownloadUpdate}>
            Download Now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
