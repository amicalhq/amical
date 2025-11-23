import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { OnboardingErrorBoundary } from "./components/ErrorBoundary";
import { api, trpcClient } from "@/trpc/react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "@/styles/globals.css";

// Create a query client for tRPC
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Handle uncaught errors
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  window.onboardingAPI.log.error("Unhandled promise rejection:", event.reason);
});

window.addEventListener("error", (event) => {
  console.error("Uncaught error:", event.error);
  window.onboardingAPI.log.error("Uncaught error:", event.error);
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <OnboardingErrorBoundary>
            <App />
          </OnboardingErrorBoundary>
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </api.Provider>
  </React.StrictMode>,
);
