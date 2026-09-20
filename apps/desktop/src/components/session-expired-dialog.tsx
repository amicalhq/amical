import { useRef, useState } from "react";
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
        setError(event.error ?? "Could not sign in. Please try again.");
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
          <AlertDialogTitle>Your session expired</AlertDialogTitle>
          <AlertDialogDescription>
            Sign in again with{" "}
            <strong>
              {authStatus.data.userEmail || "your existing account"}
            </strong>{" "}
            to continue.
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
            {logout.isLoggingOut ? "Logging out…" : "Log out"}
          </Button>
          <Button
            ref={signInButtonRef}
            disabled={login.isPending || logout.isBusy}
            onClick={() => login.mutate()}
          >
            {login.isPending ? "Opening browser…" : "Sign in again"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
