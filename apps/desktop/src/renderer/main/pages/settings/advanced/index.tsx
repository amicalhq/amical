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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useTranslation } from "react-i18next";

export default function AdvancedSettingsPage() {
  const { t } = useTranslation();
  const [preloadWhisperModel, setPreloadWhisperModel] = useState(true);
  const [keepTranscriptInClipboard, setKeepTranscriptInClipboard] =
    useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // tRPC queries and mutations
  const settingsQuery = api.settings.getSettings.useQuery();
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const telemetryQuery = api.settings.getTelemetrySettings.useQuery();
  const dataPathQuery = api.settings.getDataPath.useQuery();
  const logFilePathQuery = api.settings.getLogFilePath.useQuery();
  const machineIdQuery = api.settings.getMachineId.useQuery();
  const utils = api.useUtils();

  const updateTranscriptionSettingsMutation =
    api.settings.updateTranscriptionSettings.useMutation({
      onSuccess: () => {
        utils.settings.getSettings.invalidate();
        toast.success(t("settings.advanced.toast.settingsUpdated"));
      },
      onError: (error) => {
        console.error("Failed to update transcription settings:", error);
        toast.error(t("settings.advanced.toast.settingsUpdateFailed"));
      },
    });

  const updatePreferencesMutation =
    api.settings.updatePreferences.useMutation({
      onSuccess: () => {
        utils.settings.getPreferences.invalidate();
        toast.success(t("settings.advanced.toast.settingsUpdated"));
      },
      onError: (error) => {
        console.error("Failed to update preferences:", error);
        toast.error(t("settings.advanced.toast.settingsUpdateFailed"));
      },
    });

  const updateTelemetrySettingsMutation =
    api.settings.updateTelemetrySettings.useMutation({
      onSuccess: () => {
        utils.settings.getTelemetrySettings.invalidate();
        utils.settings.getTelemetryConfig.invalidate();
        toast.success(t("settings.advanced.toast.telemetryUpdated"));
      },
      onError: (error) => {
        console.error("Failed to update telemetry settings:", error);
        toast.error(t("settings.advanced.toast.telemetryUpdateFailed"));
      },
    });

  const resetAppMutation = api.settings.resetApp.useMutation({
    onMutate: () => {
      setIsResetting(true);
      toast.info(t("settings.advanced.toast.resetting"));
    },
    onSuccess: () => {
      toast.success(t("settings.advanced.toast.resetSuccess"));
    },
    onError: (error) => {
      setIsResetting(false);
      console.error("Failed to reset app:", error);
      toast.error(t("settings.advanced.toast.resetFailed"));
    },
  });

  const updateChannelQuery = api.settings.getUpdateChannel.useQuery();
  const setUpdateChannelMutation = api.settings.setUpdateChannel.useMutation({
    onSuccess: () => {
      utils.settings.getUpdateChannel.invalidate();
      toast.success(t("settings.advanced.updateChannel.toast.updated"));
    },
    onError: () => {
      toast.error(t("settings.advanced.updateChannel.toast.updateFailed"));
    },
  });

  const downloadLogFileMutation = api.settings.downloadLogFile.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t("settings.advanced.toast.logSaved"));
      }
    },
    onError: () => {
      toast.error(t("settings.advanced.toast.logSaveFailed"));
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

  useEffect(() => {
    if (preferencesQuery.data) {
      setKeepTranscriptInClipboard(
        preferencesQuery.data.keepTranscriptInClipboard ?? false,
      );
    }
  }, [preferencesQuery.data]);

  const handlePreloadWhisperModelChange = (checked: boolean) => {
    setPreloadWhisperModel(checked);
    updateTranscriptionSettingsMutation.mutate({
      preloadWhisperModel: checked,
    });
  };

  const handleKeepTranscriptInClipboardChange = (checked: boolean) => {
    setKeepTranscriptInClipboard(checked);
    updatePreferencesMutation.mutate({
      keepTranscriptInClipboard: checked,
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
      toast.success(t("settings.advanced.toast.machineIdCopied"));
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.advanced.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.advanced.description")}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.advanced.cardTitle")}</CardTitle>
          <CardDescription>
            {t("settings.advanced.cardDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="preload-whisper">
                {t("settings.advanced.preloadModel.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.advanced.preloadModel.description")}
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
              <Label htmlFor="keep-transcript-clipboard">
                {t("settings.advanced.keepTranscriptInClipboard.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "settings.advanced.keepTranscriptInClipboard.description",
                )}
              </p>
            </div>
            <Switch
              id="keep-transcript-clipboard"
              checked={keepTranscriptInClipboard}
              onCheckedChange={handleKeepTranscriptInClipboardChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="debug-mode">
                {t("settings.advanced.debugMode.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.advanced.debugMode.description")}
              </p>
            </div>
            <Switch id="debug-mode" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="update-channel">
                {t("settings.advanced.updateChannel.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.advanced.updateChannel.description")}
              </p>
            </div>
            <Select
              value={updateChannelQuery.data ?? "stable"}
              onValueChange={(value: "stable" | "beta") =>
                setUpdateChannelMutation.mutate(value)
              }
            >
              <SelectTrigger className="w-[120px]" id="update-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">
                  {t("settings.advanced.updateChannel.options.stable")}
                </SelectItem>
                <SelectItem value="beta">
                  {t("settings.advanced.updateChannel.options.beta")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="telemetry">
                {t("settings.advanced.telemetry.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.advanced.telemetry.description")}{" "}
                <button
                  onClick={handleOpenTelemetryDocs}
                  className="text-primary hover:underline"
                >
                  {t("settings.advanced.telemetry.learnMore")}
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
            <Label htmlFor="data-location">
              {t("settings.advanced.dataLocation.label")}
            </Label>
            <Input
              id="data-location"
              value={dataPathQuery.data || t("settings.advanced.loadingValue")}
              disabled
              className="cursor-default"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="log-location">
              {t("settings.advanced.logLocation.label")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="log-location"
                value={
                  logFilePathQuery.data || t("settings.advanced.loadingValue")
                }
                disabled
                className="cursor-default flex-1"
              />
              <Button
                variant="outline"
                onClick={() => downloadLogFileMutation.mutate()}
                disabled={downloadLogFileMutation.isPending}
              >
                {t("settings.advanced.logLocation.download")}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="machine-id">
              {t("settings.advanced.machineId.label")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="machine-id"
                value={
                  machineIdQuery.data || t("settings.advanced.loadingValue")
                }
                disabled
                className="cursor-default flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={handleCopyMachineId}
                disabled={!machineIdQuery.data}
              >
                {t("settings.advanced.machineId.copy")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50 mt-6">
        <CardHeader>
          <CardTitle className="text-destructive">
            {t("settings.advanced.dangerZone.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.advanced.dangerZone.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="reset-app">
                  {t("settings.advanced.reset.label")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.advanced.reset.description")}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={isResetting}
                    id="reset-app"
                  >
                    {t("settings.advanced.reset.button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("settings.advanced.reset.dialog.title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("settings.advanced.reset.dialog.description")}
                      <ul className="list-disc list-inside mt-2">
                        <li>
                          {t(
                            "settings.advanced.reset.dialog.items.transcriptions",
                          )}
                        </li>
                        <li>
                          {t("settings.advanced.reset.dialog.items.notes")}
                        </li>
                        <li>
                          {t("settings.advanced.reset.dialog.items.vocabulary")}
                        </li>
                        <li>
                          {t("settings.advanced.reset.dialog.items.settings")}
                        </li>
                        <li>
                          {t("settings.advanced.reset.dialog.items.models")}
                        </li>
                      </ul>
                      <br />
                      {t("settings.advanced.reset.dialog.footer")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("settings.advanced.reset.dialog.cancel")}
                    </AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={() => resetAppMutation.mutate()}
                    >
                      {t("settings.advanced.reset.dialog.confirm")}
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
