import { useEffect, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
              ? t("settings.sidebar.logoutDialog.loggingOutTitle")
              : syncFailed
                ? t("settings.sidebar.logoutDialog.unsyncedTitle")
                : t("settings.sidebar.logoutDialog.syncingTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isLoggingOut
              ? t("settings.sidebar.logoutDialog.loggingOutDescription")
              : syncFailed
                ? t("settings.sidebar.logoutDialog.unsyncedDescription")
                : t("settings.sidebar.logoutDialog.syncingDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoggingOut}>
            {t("settings.sidebar.logoutDialog.cancel")}
          </AlertDialogCancel>
          {syncFailed && (
            <AlertDialogAction
              disabled={isLoggingOut}
              onClick={(event) => {
                event.preventDefault();
                onLogout();
              }}
            >
              {t("settings.sidebar.logoutDialog.discardAndLogOut")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
