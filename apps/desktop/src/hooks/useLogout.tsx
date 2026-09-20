import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import { LogoutDialog } from "@/components/logout-dialog";

const LogoutContext = createContext<{
  requestLogout: (
    returnFocusRef: RefObject<HTMLButtonElement | null>,
  ) => Promise<void>;
  isBusy: boolean;
  dialogOpen: boolean;
  isLoggingOut: boolean;
} | null>(null);

export function LogoutProvider({ children }: { children: ReactNode }) {
  const [isChecking, setIsChecking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const returnFocusRef = useRef<RefObject<HTMLButtonElement | null>>({
    current: null,
  });
  const apiUtils = api.useUtils();
  const mutation = api.auth.logout.useMutation({
    onSuccess: () => setDialogOpen(false),
    onError: (error) => {
      setDialogOpen(false);
      toast.error("Failed to sign out", { description: error.message });
    },
  });

  const requestLogout = async (
    triggerRef: RefObject<HTMLButtonElement | null>,
  ) => {
    returnFocusRef.current = triggerRef;
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

  return (
    <LogoutContext.Provider
      value={{
        requestLogout,
        isBusy: isChecking || dialogOpen || mutation.isPending,
        dialogOpen,
        isLoggingOut: mutation.isPending,
      }}
    >
      {children}
      {dialogOpen && (
        <LogoutDialog
          returnFocusRef={returnFocusRef.current}
          onOpenChange={setDialogOpen}
          onLogout={mutation.mutate}
          isLoggingOut={mutation.isPending}
        />
      )}
    </LogoutContext.Provider>
  );
}

export function useLogout() {
  const logout = useContext(LogoutContext);
  if (!logout) throw new Error("useLogout requires LogoutProvider");
  return logout;
}
