import React, { useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Progress } from './ui/progress';
import { Button } from './ui/button';
import { Download, RefreshCw, CheckCircle } from 'lucide-react';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo?: {
    version: string;
    releaseNotes?: string;
  };
}

export function UpdateDialog({ isOpen, onClose, updateInfo }: UpdateDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const checkUpdateStatus = async () => {
      try {
        const checking = await window.electronAPI.isCheckingForUpdate();
        const available = await window.electronAPI.isUpdateAvailable();
        setIsCheckingForUpdates(checking);
        setUpdateAvailable(available);
      } catch (error) {
        console.error('Error checking update status:', error);
      }
    };

    checkUpdateStatus();

    // Set up download progress listener
    const removeProgressListener = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setDownloadProgress(Math.round(progress.percent || 0));
    });

    return () => {
      if (removeProgressListener) removeProgressListener();
    };
  }, [isOpen]);

  const handleCheckForUpdates = async () => {
    try {
      setIsCheckingForUpdates(true);
      await window.electronAPI.checkForUpdates();
      
      // Check status after a brief delay
      setTimeout(async () => {
        const available = await window.electronAPI.isUpdateAvailable();
        setUpdateAvailable(available);
        setIsCheckingForUpdates(false);
      }, 1000);
    } catch (error) {
      console.error('Error checking for updates:', error);
      setIsCheckingForUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      await window.electronAPI.downloadUpdate();
    } catch (error) {
      console.error('Error downloading update:', error);
      setIsDownloading(false);
    }
  };

  const handleInstallUpdate = async () => {
    try {
      await window.electronAPI.quitAndInstall();
    } catch (error) {
      console.error('Error installing update:', error);
    }
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
              Click below to check for the latest version of Amical.
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
                  Version {updateInfo.version} has been downloaded and is ready to install.
                  The app will restart to complete the installation.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onClose}>Install Later</AlertDialogCancel>
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