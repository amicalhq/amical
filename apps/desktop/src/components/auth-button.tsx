import { useState, useRef, useEffect } from "react";
import { LogIn, LogOut, Loader2, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Dialog } from "@/components/ui/dialog";
import { MobileAppDialogContent } from "@/components/mobile-app-dialog";
import { useLogout } from "@/hooks/useLogout";

// Helper function to generate initials from email or name
function getInitials(email?: string | null, name?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  if (email) {
    const localPart = email.split("@")[0];
    return localPart.substring(0, 2).toUpperCase();
  }

  return "??";
}

export function AuthButton() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [mobileAppOpen, setMobileAppOpen] = useState(false);
  const logout = useLogout();
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get current auth status
  const authStatusQuery = api.auth.getAuthStatus.useQuery();

  // Clear loading timeout helper
  const clearLoadingTimeout = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearLoadingTimeout();
    };
  }, []);

  // Auth mutations
  const loginMutation = api.auth.login.useMutation({
    onMutate: () => {
      setIsLoading(true);
      // Set a 5-second timeout to reset loading state if auth doesn't complete
      clearLoadingTimeout(); // Clear any existing timeout
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoading(false);
      }, 5000);
    },
    onSuccess: () => {
      toast.info(t("settings.sidebar.signInToast.opening"));
    },
    onError: (error) => {
      clearLoadingTimeout();
      toast.error(t("settings.sidebar.signInToast.failed"), {
        description: error.message,
      });
      setIsLoading(false);
    },
  });

  // Subscribe to auth state changes
  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (data) => {
      // Auth state changed, refetch status
      clearLoadingTimeout();
      authStatusQuery.refetch();
      setIsLoading(false);
      // Failed logout also emits authenticated to resume sync for the same session.
      if (
        data.eventType === "authenticated" &&
        data.isAuthenticated &&
        !authStatusQuery.data?.isAuthenticated
      ) {
        toast.success(t("settings.sidebar.signInToast.success"));
      }
    },
    onError: (error) => {
      console.error("Auth state subscription error:", error);
    },
  });

  const handleLogin = () => {
    loginMutation.mutate();
  };

  const isBusy = isLoading || logout.isBusy;
  const isAuthenticated = authStatusQuery.data?.isAuthenticated || false;
  const userEmail = authStatusQuery.data?.userEmail;
  const userName = authStatusQuery.data?.userName;

  if (authStatusQuery.isLoading) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("settings.sidebar.accountLoading")}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  if (isAuthenticated || authStatusQuery.data?.userId) {
    const initials = getInitials(userEmail, userName);
    const displayName = userName || userEmail || t("settings.sidebar.account");

    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton ref={accountButtonRef} disabled={isBusy}>
              <Avatar className="h-4 w-4">
                <AvatarFallback className="text-[10px]">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span>{displayName}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                {userName && (
                  <p className="text-sm font-medium leading-none">{userName}</p>
                )}
                {userEmail && (
                  <p className="text-xs leading-none text-muted-foreground">
                    {userEmail}
                  </p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setMobileAppOpen(true)}>
              <Smartphone className="mr-2 h-4 w-4" />
              {t("settings.sidebar.mobileApp.label")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => logout.requestLogout(accountButtonRef)}
              disabled={isBusy}
              className="text-destructive focus:text-destructive"
            >
              {isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              {t("settings.sidebar.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={mobileAppOpen} onOpenChange={setMobileAppOpen}>
          <MobileAppDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              accountButtonRef.current?.focus();
            }}
          />
        </Dialog>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={handleLogin} disabled={isBusy}>
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        <span>{t("settings.sidebar.signIn")}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
