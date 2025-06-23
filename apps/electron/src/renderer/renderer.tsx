/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { TitleBar } from '@/components/title-bar';
import { DashboardView } from '@/components/dashboard-view';
import { VoiceRecordingView } from '@/components/voice-recording-view';
import { TranscriptionsView } from '@/components/transcriptions-view';
import { VocabularyView } from '@/components/vocabulary-view';
import { ModelsView } from '@/components/models-view';
import { SettingsView } from '@/components/settings-view';
import { ProfileView } from '@/components/profile-view';
import '@/styles/globals.css';

// import { Waveform } from '../components/Waveform'; // Waveform might not be needed if hook is removed
// import { useRecording } from '../hooks/useRecording'; // Remove hook import

const NUM_WAVEFORM_BARS = 10; // This might be unused now

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState(() => {
    // Try to restore the view from localStorage, fallback to default
    if (typeof window !== 'undefined') {
      return localStorage.getItem('amical-current-view') || 'Voice Recording';
    }
    return 'Voice Recording';
  });


  const handleNavigation = (item: any) => {
    setCurrentView(item.title);
    // Save to localStorage to preserve during HMR
    localStorage.setItem('amical-current-view', item.title);
  };

  const renderContent = () => {
    switch (currentView) {
      case 'Dashboard':
        return <DashboardView />;
      case 'Voice Recording':
        return <VoiceRecordingView />;
      case 'Transcriptions':
        return <TranscriptionsView />;
      case 'Vocabulary':
        return <VocabularyView />;
      case 'Models':
        return <ModelsView />;
      case 'Settings':
        return <SettingsView />;
      case 'Profile':
        return <ProfileView />;
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
    <ThemeProvider>
      <TitleBar />
      <SidebarProvider defaultOpen={false}>
        <AppSidebar onNavigate={handleNavigation} />
        <SidebarInset>
          {/* <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <h1 className="text-lg font-semibold">{currentView}</h1>
            </div>
            <div className="ml-auto px-4">
              <ThemeToggle />
            </div>
          </header> */}
          <div className="flex flex-1 flex-col gap-4 p-4 w-full max-w-[1440px] mx-auto pt-14">
            {renderContent()}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
