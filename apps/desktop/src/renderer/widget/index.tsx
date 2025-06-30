/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetPage } from "./pages/widget";
import { api, trpcClient } from "@/trpc/react";
import "@/styles/globals.css";

// Extend Console interface to include original methods
declare global {
  interface Console {
    original: {
      log: (...args: any[]) => void;
      info: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
      debug: (...args: any[]) => void;
    };
  }
}

// Widget scoped logger setup
const widgetLogger = window.electronAPI.log.scope("widget");

// Proxy console methods to use BOTH original console AND widget logger
const originalConsole = { ...console };
console.log = (...args: any[]) => {
  originalConsole.log(...args); // Show in dev console
  widgetLogger.info(...args); // Send via IPC
};
console.info = (...args: any[]) => {
  originalConsole.info(...args);
  widgetLogger.info(...args);
};
console.warn = (...args: any[]) => {
  originalConsole.warn(...args);
  widgetLogger.warn(...args);
};
console.error = (...args: any[]) => {
  originalConsole.error(...args);
  widgetLogger.error(...args);
};
console.debug = (...args: any[]) => {
  originalConsole.debug(...args);
  widgetLogger.debug(...args);
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
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <WidgetPage />
      </QueryClientProvider>
    </api.Provider>,
  );
} else {
  console.error(
    "FloatingButton: Root element not found in floating-button.html",
  );
}
