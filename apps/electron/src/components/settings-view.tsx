import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import { FormatterConfig } from '@/modules/formatter';

// OpenRouter models list
const OPENROUTER_MODELS = [
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'openai/gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
  { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
  { value: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5' },
];

export function SettingsView() {
  const [formatterProvider, setFormatterProvider] = useState<'openrouter'>('openrouter');
  const [openrouterModel, setOpenrouterModel] = useState('');
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [formatterEnabled, setFormatterEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Load configuration on component mount
  useEffect(() => {
    loadFormatterConfig();
  }, []);

  const loadFormatterConfig = async () => {
    try {
      const config = await window.electronAPI.getFormatterConfig();
      if (config) {
        setFormatterProvider(config.provider);
        setOpenrouterModel(config.model);
        setOpenrouterApiKey(config.apiKey);
        setFormatterEnabled(config.enabled);
      }
    } catch (error) {
      console.error('Failed to load formatter config:', error);
    }
  };

  const saveFormatterConfig = async () => {
    setIsLoading(true);
    try {
      const config: FormatterConfig = {
        provider: formatterProvider,
        model: openrouterModel,
        apiKey: openrouterApiKey,
        enabled: formatterEnabled,
      };

      await window.electronAPI.setFormatterConfig(config);
      
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save formatter config:', error);
      alert('Failed to save configuration. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Settings</h2>
      
      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="microphone">Microphone</TabsTrigger>
          <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          <TabsTrigger value="formatter">Formatter</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>Configure your general preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="launch-login">Launch at Login</Label>
                  <p className="text-sm text-muted-foreground">Start Amical when you log in</p>
                </div>
                <Switch id="launch-login" />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="minimize-tray">Minimize to Tray</Label>
                  <p className="text-sm text-muted-foreground">Keep running in system tray when closed</p>
                </div>
                <Switch id="minimize-tray" />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="theme-toggle">Theme</Label>
                  <p className="text-sm text-muted-foreground">Choose your preferred theme</p>
                </div>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="microphone" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Microphone Settings</CardTitle>
              <CardDescription>Configure your microphone preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="microphone-select">Microphone</Label>
                <select id="microphone-select" className="w-full border rounded px-3 py-2">
                  <option>System Default</option>
                  <option>Built-in Microphone</option>
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="input-volume">Input Volume</Label>
                <input type="range" id="input-volume" className="w-full" min="0" max="100" defaultValue="75" />
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch id="noise-reduction" />
                <Label htmlFor="noise-reduction">Enable noise reduction</Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="shortcuts" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Keyboard Shortcuts</CardTitle>
              <CardDescription>Customize your keyboard shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Global Shortcut</Label>
                  <p className="text-sm text-muted-foreground">Start/stop recording</p>
                </div>
                <kbd className="px-2 py-1 bg-muted rounded text-sm">Ctrl+Shift+Space</kbd>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label>Toggle Window</Label>
                  <p className="text-sm text-muted-foreground">Show/hide main window</p>
                </div>
                <kbd className="px-2 py-1 bg-muted rounded text-sm">Ctrl+Shift+A</kbd>
              </div>
              
              <Button variant="outline">Customize Shortcuts</Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="formatter" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Text Formatting Configuration</CardTitle>
              <CardDescription>Configure AI-powered post-processing of transcriptions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="formatter-provider">Provider</Label>
                <Select value={formatterProvider} onValueChange={(value: 'openrouter') => setFormatterProvider(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {formatterProvider === 'openrouter' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="openrouter-model">Model</Label>
                    <Select value={openrouterModel} onValueChange={setOpenrouterModel}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {OPENROUTER_MODELS.map((model) => (
                          <SelectItem key={model.value} value={model.value}>
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="openrouter-api-key">API Key</Label>
                    <Input
                      id="openrouter-api-key"
                      type="password"
                      placeholder="Enter your OpenRouter API key"
                      value={openrouterApiKey}
                      onChange={(e) => setOpenrouterApiKey(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Get your API key from <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="underline">openrouter.ai</a>
                    </p>
                  </div>
                </>
              )}
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enable-formatter">Enable Formatter</Label>
                  <p className="text-sm text-muted-foreground">Apply AI formatting to transcriptions</p>
                </div>
                <Switch 
                  id="enable-formatter" 
                  checked={formatterEnabled}
                  onCheckedChange={setFormatterEnabled}
                />
              </div>
              
              <div className="pt-4">
                <Button 
                  onClick={saveFormatterConfig}
                  disabled={isLoading || !openrouterModel || !openrouterApiKey}
                >
                  {isLoading ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="advanced" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Advanced Settings</CardTitle>
              <CardDescription>Advanced configuration options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="debug-mode">Debug Mode</Label>
                  <p className="text-sm text-muted-foreground">Enable detailed logging</p>
                </div>
                <Switch id="debug-mode" />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="auto-update">Auto Updates</Label>
                  <p className="text-sm text-muted-foreground">Automatically check for updates</p>
                </div>
                <Switch id="auto-update" defaultChecked />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="data-location">Data Location</Label>
                <div className="flex space-x-2">
                  <input 
                    type="text" 
                    id="data-location" 
                    className="flex-1 border rounded px-3 py-2"
                    value="~/Documents/Amical"
                    readOnly
                  />
                  <Button variant="outline">Change</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 