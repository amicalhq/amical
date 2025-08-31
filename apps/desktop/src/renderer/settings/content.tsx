import React from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SettingsSidebar } from "./components/settings-sidebar";
import { SiteHeader } from "@/components/site-header";
import PreferencesSettingsPage from "./pages/preferences";
import DictationSettingsPage from "./pages/dictation";
import VocabularySettingsPage from "./pages/vocabulary";
import AIModelsSettingsPage from "./pages/ai-models";
import HistorySettingsPage from "./pages/history";
import AboutSettingsPage from "./pages/about";
import AdvancedSettingsPage from "./pages/advanced";
import { ShortcutsSettingsPage } from "./pages/shortcuts";

const SettingsApp: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleBackToMain = () => {
    navigate("/transcriptions");
  };

  const getSettingsPageTitle = (pathname: string): string => {
    const routes: Record<string, string> = {
      "/": "Preferences",
      "/dictation": "Dictation",
      "/vocabulary": "Vocabulary",
      "/ai-models": "AI Models",
      "/history": "History",
      "/advanced": "Advanced",
      "/about": "About",
    };
    return routes[pathname] || "Settings";
  };

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
        <SiteHeader
          currentView={`${getSettingsPageTitle(location.pathname)}`}
        />

        <div className="flex flex-1 min-h-0">
          <SettingsSidebar variant="inset" onBackToMain={handleBackToMain} />
          <SidebarInset className="mt-0!">
            <div className="flex flex-1 flex-col min-h-0">
              <div className="@container/settings flex flex-1 flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  <div
                    className="mx-auto w-full flex flex-col gap-4 md:gap-6"
                    style={{
                      maxWidth: "var(--content-max-width)",
                      padding: "var(--content-padding)",
                    }}
                  >
                    <Routes>
                      <Route path="/" element={<PreferencesSettingsPage />} />
                      <Route
                        path="/dictation"
                        element={<DictationSettingsPage />}
                      />

                      <Route
                        path="/shortcuts"
                        element={<ShortcutsSettingsPage />}
                      />

                      <Route
                        path="/vocabulary"
                        element={<VocabularySettingsPage />}
                      />
                      <Route
                        path="/ai-models"
                        element={<AIModelsSettingsPage />}
                      />
                      <Route
                        path="/history"
                        element={<HistorySettingsPage />}
                      />
                      <Route
                        path="/advanced"
                        element={<AdvancedSettingsPage />}
                      />
                      <Route path="/about" element={<AboutSettingsPage />} />
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

export default SettingsApp;
