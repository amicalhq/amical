import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, trpcClient } from "@/trpc/react";
import { usePostHog } from "../lib/posthog";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export const Route = createRootRoute({
  component: RootComponent,
});

// Inner component that uses hooks requiring provider context
function AppShell() {
  usePostHog(); // Initialize and sync telemetry
  const utils = api.useUtils();

  useEffect(() => {
    const handleSettingsChanged = (payload?: {
      source?: string;
      changes?: string[];
    }) => {
      void utils.settings.getSettings.invalidate();

      if (!payload?.changes || payload.changes.includes("activeModeId")) {
        void utils.settings.getModes.invalidate();
        void utils.settings.getActiveMode.invalidate();
      }
    };

    window.electronAPI.on("settings-changed", handleSettingsChanged);
    return () => {
      window.electronAPI.off("settings-changed", handleSettingsChanged);
    };
  }, [utils]);

  return (
    <>
      <Outlet />
      {process.env.NODE_ENV === "development" && (
        <TanStackRouterDevtools position="bottom-right" />
      )}
    </>
  );
}

function RootComponent() {
  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </api.Provider>
  );
}
