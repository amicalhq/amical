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
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { VocabularyManager } from '@/components/vocabulary-manager';
import { TranscriptionsTable } from '@/components/transcriptions-table';
import '@/styles/globals.css';
import ShortcutIndicator from '../components/ShortcutIndicator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { TitleBar } from '@/components/title-bar';

// import { Waveform } from '../components/Waveform'; // Waveform might not be needed if hook is removed
// import { useRecording } from '../hooks/useRecording'; // Remove hook import

const NUM_WAVEFORM_BARS = 10; // This might be unused now

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [currentView, setCurrentView] = useState(() => {
    // Try to restore the view from localStorage, fallback to default
    if (typeof window !== 'undefined') {
      return localStorage.getItem('amical-current-view') || 'Voice Recording';
    }
    return 'Voice Recording';
  });

  const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(event.target.value);
  };

  const handleSaveApiKey = () => {
    window.electronAPI.setApiKey(apiKey);
    alert('API Key sent to main process!');
  };

  const handleNavigation = (item: any) => {
    setCurrentView(item.title);
    // Save to localStorage to preserve during HMR
    localStorage.setItem('amical-current-view', item.title);
  };

  const renderContent = () => {
    switch (currentView) {
      case 'Voice Recording':
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Voice Recording</h2>
            <p>Voice recording functionality will be implemented here.</p>
            <ShortcutIndicator />
          </div>
        );
      case 'Transcriptions':
        return <TranscriptionsTable />;
      case 'Vocabulary':
        return <VocabularyManager />;
      case 'History':
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">History</h2>
            <p>View your recording history here.</p>
          </div>
        );
      case 'Settings':
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Settings</h2>
            <Tabs defaultValue="api" className="w-full">
              <TabsList>
                <TabsTrigger value="api">API Configuration</TabsTrigger>
                <TabsTrigger value="appearance">Appearance</TabsTrigger>
                <TabsTrigger value="general">General</TabsTrigger>
              </TabsList>
              <TabsContent value="api" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="apiKey">OpenAI API Key:</Label>
                  <input
                    type="password"
                    id="apiKey"
                    name="apiKey"
                    className="border rounded px-3 py-2 w-full"
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    placeholder="Enter your OpenAI API key"
                  />
                  <Button onClick={handleSaveApiKey}>Save API Key</Button>
                </div>
              </TabsContent>
              <TabsContent value="appearance" className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium">Theme</h3>
                    <p className="text-sm text-muted-foreground">
                      Choose your preferred theme or follow system settings.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Label htmlFor="theme-toggle">Theme:</Label>
                    <ThemeToggle />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="general">
                <p>General settings will be implemented here.</p>
              </TabsContent>
            </Tabs>
          </div>
        );
      case 'Profile':
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Profile</h2>
            <p>Manage your profile settings here.</p>
          </div>
        );
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
