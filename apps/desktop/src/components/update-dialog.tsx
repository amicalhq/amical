import React from "react";
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
import { RefreshCw } from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UpdateDialog({ isOpen, onClose }: UpdateDialogProps) {
  const checkForUpdatesMutation = api.updater.checkForUpdates.useMutation({
    onSuccess: () => {
      toast.success("Update check completed");
    },
    onError: (error) => {
      console.error("Error checking for updates:", error);
      toast.error("Failed to check for updates");
    },
  });

  const handleCheckForUpdates = () => {
    checkForUpdatesMutation.mutate({ userInitiated: true });
  };

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
