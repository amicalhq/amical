import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetPage } from "./pages/widget";
import { api, trpcClient } from "@/trpc/react";
import { ThemeProvider } from "@/components/theme-provider";
import { ToasterWrapper } from "./components/ToasterWrapper";
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

// Widget scoped logger setup with guards
const widgetLogger = window.electronAPI?.log?.scope?.("widget");

// Store original console methods with proper binding
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

// Proxy console methods to use BOTH original console AND widget logger
console.log = (...args: unknown[]) => {
  originalConsole.log(...args); // Show in dev console
  widgetLogger?.info?.(...args); // Send via IPC if available
};
console.info = (...args: unknown[]) => {
  originalConsole.info(...args);
  widgetLogger?.info?.(...args);
};
console.warn = (...args: unknown[]) => {
  originalConsole.warn(...args);
  widgetLogger?.warn?.(...args);
};
console.error = (...args: unknown[]) => {
  originalConsole.error(...args);
  widgetLogger?.error?.(...args);
};
console.debug = (...args: unknown[]) => {
  originalConsole.debug(...args);
  widgetLogger?.debug?.(...args);
};

// Keep original methods available if needed
console.original = originalConsole;

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <ThemeProvider>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <WidgetPage />
          <ToasterWrapper />
        </QueryClientProvider>
      </api.Provider>
    </ThemeProvider>,
  );
} else {
  console.error(
    "FloatingButton: Root element not found in floating-button.html",
  );
}
