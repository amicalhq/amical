/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TranscriptionsPage } from "./pages/transcriptions";
import { VocabularyPage } from "./pages/vocabulary";
import { ModelsPage } from "./pages/models";
import { SettingsPage } from "./pages/settings";
import { SiteHeader } from "@/components/site-header";
import { api, trpcClient } from "@/trpc/react";
import { NotesPage } from "./pages/notes";

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
      case "Notes":
        return <NotesPage />;
      case "Vocabulary":
        return <VocabularyPage />;
      case "Settings":
        return <SettingsPage />;
      case "Transcriptions":
        return <TranscriptionsPage />;
      case "Speech Models":
      default:
        return <ModelsPage />;
    }
  };

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "calc(var(--spacing) * 52)",
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
              <SidebarInset className="mt-0!">
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
      </QueryClientProvider>
    </api.Provider>
  );
};

// Export the App component as default for lazy loading
export default App;
