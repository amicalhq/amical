import { useEffect, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/trpc/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function LogoutDialog({
  returnFocusRef,
  onOpenChange,
  onLogout,
  isLoggingOut,
}: {
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const [syncFailed, setSyncFailed] = useState(false);
  const { mutateAsync: syncBeforeLogout } =
    api.auth.syncBeforeLogout.useMutation();

  useEffect(() => {
    let active = true;
    void syncBeforeLogout().then(
      ({ synced }) => {
        if (!active) return;
        if (synced) onLogout();
        else setSyncFailed(true);
      },
      () => {
        if (active) setSyncFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [syncBeforeLogout, onLogout]);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!isLoggingOut) onOpenChange(open);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {(!syncFailed || isLoggingOut) && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {isLoggingOut
              ? "Logging out…"
              : syncFailed
                ? "You have unsynced changes"
                : "Syncing unsaved changes…"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isLoggingOut
              ? "Amical will restart shortly."
              : syncFailed
                ? "Logging out without syncing will permanently discard these changes. They won’t be restored when you sign back in."
                : "This can take up to 15 seconds. Amical will log out and restart when syncing finishes."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoggingOut}>Cancel</AlertDialogCancel>
          {syncFailed && (
            <AlertDialogAction
              disabled={isLoggingOut}
              onClick={(event) => {
                event.preventDefault();
                onLogout();
              }}
            >
              Discard changes and log out
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
