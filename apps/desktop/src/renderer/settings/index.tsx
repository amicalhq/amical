import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

// Lazy import the settings content
const Content = React.lazy(
  () =>
    import("./content.js") as unknown as Promise<{
      default: React.ComponentType;
    }>,
);

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

// Settings window scoped logger setup with guards
const settingsWindowLogger = window.electronAPI?.log?.scope?.("settingsWindow");

// Store original console methods with proper binding
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

// Proxy console methods to use BOTH original console AND settings window logger
console.log = (...args: unknown[]) => {
  originalConsole.log(...args); // Show in dev console
  settingsWindowLogger.info(...args); // Send via IPC if available
};
console.info = (...args: unknown[]) => {
  originalConsole.info(...args);
  settingsWindowLogger.info(...args);
};
console.warn = (...args: unknown[]) => {
  originalConsole.warn(...args);
  settingsWindowLogger.warn(...args);
};
console.error = (...args: unknown[]) => {
  originalConsole.error(...args);
  settingsWindowLogger.error(...args);
};
console.debug = (...args: unknown[]) => {
  originalConsole.debug(...args);
  settingsWindowLogger.debug(...args);
};

// Keep original methods available if needed
console.original = originalConsole;

// Loading spinner component
const LoadingSpinner: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 border-4 border-muted rounded-full"></div>
          <div className="w-12 h-12 border-4 border-foreground border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
        </div>
        <p className="text-sm text-muted-foreground">Loading Settings...</p>
      </div>
    </div>
  );
};

// Main App component with Suspense
const App: React.FC = () => {
  return (
    <ThemeProvider>
      <MemoryRouter>
        <Suspense fallback={<LoadingSpinner />}>
          <Content />
        </Suspense>
      </MemoryRouter>
      <Toaster />
    </ThemeProvider>
  );
};

// Render the app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
