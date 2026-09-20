import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/trpc/react";

export function useLogout() {
  const [isChecking, setIsChecking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const apiUtils = api.useUtils();
  const mutation = api.auth.logout.useMutation({
    onSuccess: () => setDialogOpen(false),
    onError: (error) => {
      setDialogOpen(false);
      toast.error("Failed to sign out", { description: error.message });
    },
  });

  const requestLogout = async () => {
    setIsChecking(true);
    try {
      const { hasPendingChanges } =
        await apiUtils.client.auth.getLogoutStatus.query();
      if (hasPendingChanges) setDialogOpen(true);
      else mutation.mutate();
    } catch (error) {
      toast.error("Failed to sign out", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsChecking(false);
    }
  };

  return {
    requestLogout,
    isBusy: isChecking || dialogOpen || mutation.isPending,
    dialogOpen,
    setDialogOpen,
    confirmLogout: mutation.mutate,
    isLoggingOut: mutation.isPending,
  };
}
