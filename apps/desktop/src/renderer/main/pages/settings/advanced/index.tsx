import React, { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export default function AdvancedSettingsPage() {
  const [preloadWhisperModel, setPreloadWhisperModel] = useState(true);
  const [isResetting, setIsResetting] = useState(false);

  // tRPC queries and mutations
  const settingsQuery = api.settings.getSettings.useQuery();
  const telemetryQuery = api.settings.getTelemetrySettings.useQuery();
  const dataPathQuery = api.settings.getDataPath.useQuery();
  const logFilePathQuery = api.settings.getLogFilePath.useQuery();
  const machineIdQuery = api.settings.getMachineId.useQuery();
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

  const updateTelemetrySettingsMutation =
    api.settings.updateTelemetrySettings.useMutation({
      onSuccess: () => {
        utils.settings.getTelemetrySettings.invalidate();
        utils.settings.getTelemetryConfig.invalidate();
        toast.success("Telemetry settings updated");
      },
      onError: (error) => {
        console.error("Failed to update telemetry settings:", error);
        toast.error("Failed to update telemetry settings. Please try again.");
      },
    });

  const resetAppMutation = api.settings.resetApp.useMutation({
    onMutate: () => {
      setIsResetting(true);
      toast.info("Resetting app...");
    },
    onSuccess: () => {
      toast.success("App reset successfully. Restarting...");
    },
    onError: (error) => {
      setIsResetting(false);
      console.error("Failed to reset app:", error);
      toast.error("Failed to reset app. Please try again.");
    },
  });

  const downloadLogFileMutation = api.settings.downloadLogFile.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Log file saved successfully");
      }
    },
    onError: () => {
      toast.error("Failed to save log file");
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

  const handleTelemetryChange = (checked: boolean) => {
    updateTelemetrySettingsMutation.mutate({
      enabled: checked,
    });
  };

  const handleOpenTelemetryDocs = () => {
    window.electronAPI.openExternal("https://amical.ai/docs/telemetry");
  };

  const handleCopyMachineId = async () => {
    if (machineIdQuery.data) {
      await navigator.clipboard.writeText(machineIdQuery.data);
      toast.success("Machine ID copied to clipboard");
    }
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

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="telemetry">Anonymous Telemetry</Label>
              <p className="text-sm text-muted-foreground">
                Help improve Vox by sharing anonymous usage data.{" "}
                <button
                  onClick={handleOpenTelemetryDocs}
                  className="text-primary hover:underline"
                >
                  Learn more
                </button>
              </p>
            </div>
            <Switch
              id="telemetry"
              checked={telemetryQuery.data?.enabled ?? true}
              onCheckedChange={handleTelemetryChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="data-location">Data Location</Label>
            <Input
              id="data-location"
              value={dataPathQuery.data || "Loading..."}
              disabled
              className="cursor-default"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="log-location">Log File Location</Label>
            <div className="flex gap-2">
              <Input
                id="log-location"
                value={logFilePathQuery.data || "Loading..."}
                disabled
                className="cursor-default flex-1"
              />
              <Button
                variant="outline"
                onClick={() => downloadLogFileMutation.mutate()}
                disabled={downloadLogFileMutation.isPending}
              >
                Download
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="machine-id">Machine ID</Label>
            <div className="flex gap-2">
              <Input
                id="machine-id"
                value={machineIdQuery.data || "Loading..."}
                disabled
                className="cursor-default flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={handleCopyMachineId}
                disabled={!machineIdQuery.data}
              >
                Copy
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50 mt-6">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Actions here are irreversible and will delete all your data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="reset-app">Reset App</Label>
                <p className="text-sm text-muted-foreground">
                  Delete all data and start fresh
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={isResetting}
                    id="reset-app"
                  >
                    Reset App
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Are you absolutely sure?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently
                      delete:
                      <ul className="list-disc list-inside mt-2">
                        <li>All your transcriptions</li>
                        <li>Your vocabulary</li>
                        <li>All settings and preferences</li>
                        <li>Downloaded models</li>
                      </ul>
                      <br />
                      The app will restart with a fresh installation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={() => resetAppMutation.mutate()}
                    >
                      Yes, delete everything
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
