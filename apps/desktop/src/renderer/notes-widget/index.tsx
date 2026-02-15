import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { NotesWidgetPage } from "./pages/notes-widget";
import { api, trpcClient } from "@/trpc/react";
import { ThemeProvider } from "@/components/theme-provider";
import { initializeRendererI18n } from "@/renderer/lib/initialize-i18n";
import { Toaster } from "@/components/ui/sonner";
import { usePostHog } from "@/renderer/main/lib/posthog";
import "@/styles/globals.css";

// Extend Console interface to include original methods
declare global {
  interface Console {
    original: {
      log: (...data: unknown[]) => void;
      info: (...data: unknown[]) => void;
      warn: (...data: unknown[]) => void;
      error: (...data: unknown[]) => void;
      debug: (...data: unknown[]) => void;
    };
  }
}

const notesWidgetLogger = window.electronAPI?.log?.scope?.("notesWidget");

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

console.log = (...args: unknown[]) => {
  originalConsole.log(...args);
  notesWidgetLogger?.info?.(...args);
};
console.info = (...args: unknown[]) => {
  originalConsole.info(...args);
  notesWidgetLogger?.info?.(...args);
};
console.warn = (...args: unknown[]) => {
  originalConsole.warn(...args);
  notesWidgetLogger?.warn?.(...args);
};
console.error = (...args: unknown[]) => {
  originalConsole.error(...args);
  notesWidgetLogger?.error?.(...args);
};
console.debug = (...args: unknown[]) => {
  originalConsole.debug(...args);
  notesWidgetLogger?.debug?.(...args);
};

console.original = originalConsole;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const NotesWidgetShell: React.FC = () => {
  usePostHog();

  return (
    <>
      <NotesWidgetPage />
      <Toaster />
    </>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  const bootstrap = async () => {
    const i18n = await initializeRendererI18n();

    root.render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <api.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>
              <NotesWidgetShell />
            </QueryClientProvider>
          </api.Provider>
        </ThemeProvider>
      </I18nextProvider>,
    );
  };

  void bootstrap().catch((error) => {
    console.error("Failed to initialize i18n", error);
  });
} else {
  console.error("NotesWidget: Root element not found in notes-widget.html");
}
