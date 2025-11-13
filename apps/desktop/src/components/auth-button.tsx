import { useState, useRef, useEffect } from "react";
import { LogIn, LogOut, Loader2 } from "lucide-react";
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
  const [isLoading, setIsLoading] = useState(false);
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
      toast.info("Opening browser for sign in...");
    },
    onError: (error) => {
      clearLoadingTimeout();
      toast.error("Failed to initiate login", {
        description: error.message,
      });
      setIsLoading(false);
    },
  });

  const logoutMutation = api.auth.logout.useMutation({
    onMutate: () => {
      setIsLoading(true);
    },
    onSuccess: () => {
      toast.success("Signed out successfully");
      setIsLoading(false);
      // Invalidate auth queries
      authStatusQuery.refetch();
    },
    onError: (error) => {
      toast.error("Failed to sign out", {
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
      // Only show toast for actual authentication events, not initial state
      if (data.eventType === "authenticated" && data.isAuthenticated) {
        toast.success("Signed in successfully");
      }
    },
    onError: (error) => {
      console.error("Auth state subscription error:", error);
    },
  });

  const handleLogin = () => {
    loginMutation.mutate();
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const isAuthenticated = authStatusQuery.data?.isAuthenticated || false;
  const userEmail = authStatusQuery.data?.userEmail;
  const userName = authStatusQuery.data?.userName;

  if (authStatusQuery.isLoading) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading...</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  if (isAuthenticated) {
    const initials = getInitials(userEmail, userName);
    const displayName = userName || userEmail || "Account";

    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton disabled={isLoading}>
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
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={isLoading}
              className="text-destructive focus:text-destructive"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={handleLogin} disabled={isLoading}>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        <span>Sign In</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
