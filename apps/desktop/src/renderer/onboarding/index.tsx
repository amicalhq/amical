import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { App } from "./App";
import { OnboardingErrorBoundary } from "./components/ErrorBoundary";
import { api, trpcClient } from "@/trpc/react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { initializeRendererI18n } from "@/renderer/lib/initialize-i18n";
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
  // Error logged to console - main process can monitor renderer logs if needed
});

window.addEventListener("error", (event) => {
  console.error("Uncaught error:", event.error);
  // Error logged to console - main process can monitor renderer logs if needed
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

const bootstrap = async () => {
  const i18n = await initializeRendererI18n();

  root.render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <api.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <OnboardingErrorBoundary>
                <App />
              </OnboardingErrorBoundary>
              <Toaster position="top-right" />
            </ThemeProvider>
          </QueryClientProvider>
        </api.Provider>
      </I18nextProvider>
    </React.StrictMode>,
  );
};

void bootstrap().catch((error) => {
  console.error("Failed to initialize i18n", error);
});
