import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/trpc/react";
import { useLogout } from "@/hooks/useLogout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function SessionExpiredDialog() {
  const { t } = useTranslation();
  const authStatus = api.auth.getAuthStatus.useQuery();
  const [error, setError] = useState<string | null>(null);
  const signInButtonRef = useRef<HTMLButtonElement>(null);
  const logoutButtonRef = useRef<HTMLButtonElement>(null);
  const logout = useLogout();
  const login = api.auth.login.useMutation({
    onMutate: () => setError(null),
    onError: (error) => setError(error.message),
  });

  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (event) => {
      if (event.eventType === "auth-error") {
        setError(
          event.error ?? t("settings.sidebar.sessionExpired.signInFailed"),
        );
      } else {
        setError(null);
      }
      void authStatus.refetch();
    },
  });

  // Invalid credentials retain the account owner; explicit logout removes it.
  if (!authStatus.data?.userId || authStatus.data.isAuthenticated) return null;

  return (
    <AlertDialog open={!logout.dialogOpen}>
      <AlertDialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          signInButtonRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings.sidebar.sessionExpired.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans
              i18nKey="settings.sidebar.sessionExpired.description"
              values={{
                account:
                  authStatus.data.userEmail ||
                  t("settings.sidebar.sessionExpired.existingAccount"),
              }}
              components={{ strong: <strong /> }}
            />
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button
            ref={logoutButtonRef}
            variant="outline"
            disabled={login.isPending || logout.isBusy}
            onClick={() => logout.requestLogout(logoutButtonRef)}
          >
            {logout.isLoggingOut
              ? t("settings.sidebar.sessionExpired.signingOut")
              : t("settings.sidebar.sessionExpired.signOut")}
          </Button>
          <Button
            ref={signInButtonRef}
            disabled={login.isPending || logout.isBusy}
            onClick={() => login.mutate()}
          >
            {login.isPending
              ? t("settings.sidebar.sessionExpired.openingBrowser")
              : t("settings.sidebar.sessionExpired.signIn")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
