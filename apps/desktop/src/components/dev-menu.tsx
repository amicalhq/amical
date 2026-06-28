import * as React from "react";
import { IconCode, IconRefresh } from "@tabler/icons-react";
import { Eraser, KeyRound, Loader2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { clearRemoteConfigDismissals } from "@/utils/remote-config-dismissals";
import { api } from "@/trpc/react";

function DevActionButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DevMenu() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const updateUIThemeMutation = api.settings.updateUITheme.useMutation();
  const utils = api.useUtils();

  const refreshFeatureFlagsMutation = api.featureFlags.refresh.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.featureFlags.getAll.invalidate(),
        utils.featureFlags.getFlag.invalidate(),
      ]);
      toast.success("Feature flags refreshed");
    },
    onError: (error) => {
      toast.error("Failed to refresh feature flags", {
        description: error.message,
      });
    },
  });

  const refreshRemoteConfigMutation = api.remoteConfig.refresh.useMutation({
    onSuccess: async () => {
      await utils.remoteConfig.get.invalidate();
      toast.success("Remote config refreshed");
    },
    onError: (error) => {
      toast.error("Failed to refresh remote config", {
        description: error.message,
      });
    },
  });

  const copyAuthTokenMutation = api.auth.getIdToken.useMutation({
    onSuccess: async ({ token }) => {
      if (!token) {
        toast.error("Not signed in", {
          description: "No auth token available.",
        });
        return;
      }
      await navigator.clipboard.writeText(token);
      toast.success("Auth token copied", {
        description: `${token.slice(0, 32)}…`,
      });
    },
    onError: (error) => {
      toast.error("Couldn't get auth token", { description: error.message });
    },
  });

  const effectiveTheme = resolvedTheme ?? theme;
  const isDark = effectiveTheme === "dark";

  const toggleTheme = () => {
    const nextTheme: "light" | "dark" = isDark ? "light" : "dark";
    setTheme(nextTheme);
    updateUIThemeMutation.mutate({ theme: nextTheme });
  };

  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton>
            <IconCode />
            <span>Developer</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-72 p-3">
          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
                <IconCode className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Developer</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Local-only controls for checking development states.
                </p>
              </div>
            </div>

            <div className="grid gap-1 border-t pt-2">
              <DevActionButton onClick={toggleTheme}>
                {isDark ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
                <span>
                  {isDark ? "Switch to light mode" : "Switch to dark mode"}
                </span>
              </DevActionButton>
              <DevActionButton
                disabled={refreshFeatureFlagsMutation.isPending}
                onClick={() => refreshFeatureFlagsMutation.mutate()}
              >
                {refreshFeatureFlagsMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <IconRefresh className="size-4" />
                )}
                <span>Refresh feature flags</span>
              </DevActionButton>
              <DevActionButton
                disabled={refreshRemoteConfigMutation.isPending}
                onClick={() => refreshRemoteConfigMutation.mutate()}
              >
                {refreshRemoteConfigMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <IconRefresh className="size-4" />
                )}
                <span>Refresh remote config</span>
              </DevActionButton>
              <DevActionButton
                onClick={() => {
                  clearRemoteConfigDismissals();
                  toast.success("Dismissed surfaces cleared");
                }}
              >
                <Eraser className="size-4" />
                <span>Clear dismissed surfaces</span>
              </DevActionButton>
              <DevActionButton
                disabled={copyAuthTokenMutation.isPending}
                onClick={() => copyAuthTokenMutation.mutate()}
              >
                {copyAuthTokenMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                <span>Copy auth token</span>
              </DevActionButton>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
