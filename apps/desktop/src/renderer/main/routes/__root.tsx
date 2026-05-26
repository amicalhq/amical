import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, trpcClient } from "@/trpc/react";
import { usePostHog } from "../lib/posthog";
import { UpdatePrompt } from "../components/update-prompt/update-prompt";

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

  return (
    <>
      <Outlet />
      <UpdatePrompt />
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
