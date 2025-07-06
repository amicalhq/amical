import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

// Lazy import the main content
const Content = React.lazy(
  () =>
    import("./content.js") as unknown as Promise<{
      default: React.ComponentType<any>;
    }>,
);

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

// Main window scoped logger setup
const mainWindowLogger = window.electronAPI.log.scope("mainWindow");

// Proxy console methods to use BOTH original console AND main window logger
const originalConsole = { ...console };
console.log = (...args: any[]) => {
  originalConsole.log(...args); // Show in dev console
  mainWindowLogger.info(...args); // Send via IPC
};
console.info = (...args: any[]) => {
  originalConsole.info(...args);
  mainWindowLogger.info(...args);
};
console.warn = (...args: any[]) => {
  originalConsole.warn(...args);
  mainWindowLogger.warn(...args);
};
console.error = (...args: any[]) => {
  originalConsole.error(...args);
  mainWindowLogger.error(...args);
};
console.debug = (...args: any[]) => {
  originalConsole.debug(...args);
  mainWindowLogger.debug(...args);
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
        <p className="text-sm text-muted-foreground">Loading Amical...</p>
      </div>
    </div>
  );
};

// Main App component with Suspense
const App: React.FC = () => {
  return (
    <ThemeProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Content />
      </Suspense>
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
