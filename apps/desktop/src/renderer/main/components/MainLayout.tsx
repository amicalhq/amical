import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TranscriptionsPage } from "../pages/transcriptions";
import { VocabularyPage } from "../pages/vocabulary";
import { ModelsPage } from "../pages/models";
import { SiteHeader } from "@/components/site-header";
import { SettingsPage } from "../pages/settings";

// Helper function to get page title from pathname
const getPageTitle = (pathname: string): string => {
  const routes: Record<string, string> = {
    "/transcriptions": "Transcriptions",
    "/vocabulary": "Vocabulary",
    "/models": "Speech Models",
    "/settings": "Settings",
  };
  return routes[pathname] || "Transcriptions";
};

// Main layout component for non-settings pages
export const MainLayout: React.FC = () => {
  const location = useLocation();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 52)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <div className="flex h-screen w-screen flex-col">
        <SiteHeader currentView={getPageTitle(location.pathname)} />

        <div className="flex flex-1 min-h-0">
          <AppSidebar variant="inset" />
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
                    <Routes>
                      <Route
                        path="/"
                        element={<Navigate to="/transcriptions" replace />}
                      />
                      <Route
                        path="/transcriptions"
                        element={<TranscriptionsPage />}
                      />
                      <Route path="/vocabulary" element={<VocabularyPage />} />
                      <Route path="/models" element={<ModelsPage />} />
                      <Route path="/settings-og" element={<SettingsPage />} />
                    </Routes>
                  </div>
                </div>
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
};
