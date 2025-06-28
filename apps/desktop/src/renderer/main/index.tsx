/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ipcLink } from "electron-trpc-experimental/renderer";
import superjson from "superjson";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { TranscriptionsPage } from "./pages/transcriptions";
import { VocabularyPage } from "./pages/vocabulary";
import { ModelsPage } from "./pages/models";
import { SettingsPage } from "./pages/settings";
import "@/styles/globals.css";
import { SiteHeader } from "@/components/site-header";
import { api } from "@/trpc/react";

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

// import { Waveform } from '../components/Waveform'; // Waveform might not be needed if hook is removed
// import { useRecording } from '../hooks/useRecording'; // Remove hook import

const NUM_WAVEFORM_BARS = 10; // This might be unused now

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Create tRPC client
const trpcClient = api.createClient({
  links: [ipcLink({ transformer: superjson })],
});

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState(() => {
    // Try to restore the view from localStorage, fallback to default
    if (typeof window !== "undefined") {
      return localStorage.getItem("amical-current-view") || "Voice Recording";
    }
    return "Voice Recording";
  });

  const handleNavigation = (item: any) => {
    setCurrentView(item.title);
    // Save to localStorage to preserve during HMR
    localStorage.setItem("amical-current-view", item.title);
  };

  const renderContent = () => {
    switch (currentView) {
      case "Transcriptions":
        return <TranscriptionsPage />;
      case "Vocabulary":
        return <VocabularyPage />;
      case "Models":
        return <ModelsPage />;
      case "Settings":
        return <SettingsPage />;
      default:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Welcome to Amical</h2>
            <p>Select an option from the sidebar to get started.</p>
          </div>
        );
    }
  };

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SidebarProvider
            style={
              {
                "--sidebar-width": "calc(var(--spacing) * 72)",
                "--header-height": "calc(var(--spacing) * 12)",
              } as React.CSSProperties
            }
          >
            <div className="flex h-screen w-screen flex-col">
              {/* Header spans full width with traffic light spacing */}
              <SiteHeader currentView={currentView} />

              <div className="flex flex-1 min-h-0">
                <AppSidebar
                  variant="inset"
                  onNavigate={handleNavigation}
                  currentView={currentView}
                />
                <SidebarInset>
                  <div className="flex flex-1 flex-col min-h-0">
                    <div className="@container/main flex flex-1 flex-col min-h-0 overflow-hidden">
                      <div className="flex-1 overflow-y-auto">
                        <div
                          className="mx-auto w-full flex flex-col gap-4 md:gap-6"
                          style={{
                            maxWidth: "var(--content-max-width)",
                            padding: "var(--content-padding)",
                          }}
                        >
                          {renderContent()}
                        </div>
                      </div>
                    </div>
                  </div>
                </SidebarInset>
              </div>
            </div>
          </SidebarProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </api.Provider>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
