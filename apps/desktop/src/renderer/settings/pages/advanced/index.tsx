import React, { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export default function AdvancedSettingsPage() {
  const [preloadWhisperModel, setPreloadWhisperModel] = useState(true);

  // tRPC queries and mutations
  const settingsQuery = api.settings.getSettings.useQuery();
  const utils = api.useUtils();

  const updateTranscriptionSettingsMutation =
    api.settings.updateTranscriptionSettings.useMutation({
      onSuccess: () => {
        utils.settings.getSettings.invalidate();
        toast.success("Settings updated");
      },
      onError: (error) => {
        console.error("Failed to update transcription settings:", error);
        toast.error("Failed to update settings. Please try again.");
      },
    });

  // Load settings when query data is available
  useEffect(() => {
    if (settingsQuery.data?.transcription) {
      setPreloadWhisperModel(
        settingsQuery.data.transcription.preloadWhisperModel !== false,
      );
    }
  }, [settingsQuery.data]);

  const handlePreloadWhisperModelChange = (checked: boolean) => {
    setPreloadWhisperModel(checked);
    updateTranscriptionSettingsMutation.mutate({
      preloadWhisperModel: checked,
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Advanced</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Advanced configuration options and experimental features
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Advanced configuration options</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="preload-whisper">Preload Whisper Model</Label>
              <p className="text-sm text-muted-foreground">
                Load AI model at startup for faster transcription
              </p>
            </div>
            <Switch
              id="preload-whisper"
              checked={preloadWhisperModel}
              onCheckedChange={handlePreloadWhisperModelChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="debug-mode">Debug Mode</Label>
              <p className="text-sm text-muted-foreground">
                Enable detailed logging
              </p>
            </div>
            <Switch id="debug-mode" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="auto-update">Auto Updates</Label>
              <p className="text-sm text-muted-foreground">
                Automatically check for updates
              </p>
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
    </div>
  );
}
