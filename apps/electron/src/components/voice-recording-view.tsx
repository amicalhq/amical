import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import ShortcutIndicator from './ShortcutIndicator';

export function VoiceRecordingView() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground">Global Shortcut:</span>
          <kbd className="px-2 py-1 bg-muted rounded text-sm">Ctrl+Shift+Space</kbd>
        </div>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>Start recording with a single click</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button size="lg" className="w-full">
              <span className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                <span>Start Recording</span>
              </span>
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Or use <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+Shift+Space</kbd>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recording Settings</CardTitle>
            <CardDescription>Configure your recording preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="microphone">Microphone</Label>
              <select id="microphone" className="w-full border rounded px-3 py-2">
                <option>System Default</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="auto-transcribe" />
              <Label htmlFor="auto-transcribe">Auto-transcribe recordings</Label>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <ShortcutIndicator />
    </div>
  );
} 