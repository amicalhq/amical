import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function MicrophoneSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Microphone Settings</CardTitle>
        <CardDescription>Configure your microphone preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="microphone-select">Microphone</Label>
          <select
            id="microphone-select"
            className="w-full border rounded px-3 py-2"
          >
            <option>System Default</option>
            <option>Built-in Microphone</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="input-volume">Input Volume</Label>
          <input
            type="range"
            id="input-volume"
            className="w-full"
            min="0"
            max="100"
            defaultValue="75"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Switch id="noise-reduction" />
          <Label htmlFor="noise-reduction">Enable noise reduction</Label>
        </div>
      </CardContent>
    </Card>
  );
}
