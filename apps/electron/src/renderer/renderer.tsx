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
import '@/styles/globals.css';
import ShortcutIndicator from '../components/ShortcutIndicator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// import { Waveform } from '../components/Waveform'; // Waveform might not be needed if hook is removed
// import { useRecording } from '../hooks/useRecording'; // Remove hook import

const NUM_WAVEFORM_BARS = 10; // This might be unused now

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState('');

  const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(event.target.value);
  };

  const handleSaveApiKey = () => {
    window.electronAPI.setApiKey(apiKey);
    alert('API Key sent to main process!');
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <Tabs defaultValue="dictionary" className="w-[400px]">
        <TabsList>
          <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
          <TabsTrigger value="api">Configure API Key</TabsTrigger>
        </TabsList>
        <TabsContent value="dictionary">Dictionary Tab Content</TabsContent>
        <TabsContent value="api">API Key Configuration Content</TabsContent>
        <TabsContent value="api">
          <div>
            <label htmlFor="apiKey">API Key:</label>
            <input
              type="password"
              id="apiKey"
              name="apiKey"
              className="border rounded px-2 py-1"
              value={apiKey}
              onChange={handleApiKeyChange}
            />
            <Button onClick={handleSaveApiKey}>Save API Key</Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
