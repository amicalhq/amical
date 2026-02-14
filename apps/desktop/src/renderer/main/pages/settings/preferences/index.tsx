import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
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
} from "@/components/ui/alert-dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function PreferencesSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState<string>("system");

  // tRPC queries and mutations
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const uiSettingsQuery = api.settings.getUISettings.useQuery();
  const updatePreferencesMutation = api.settings.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success(t("settings.preferences.toast.updated"));
      utils.settings.getPreferences.invalidate();
    },
    onError: (error) => {
      console.error("Failed to update preferences:", error);
      toast.error(t("settings.preferences.toast.updateFailed"));
    },
  });
  const updateUILocaleMutation = api.settings.updateUILocale.useMutation({
    onSuccess: () => {
      utils.settings.getUISettings.invalidate();
      utils.settings.getSettings.invalidate();
      setRestartDialogOpen(true);
    },
    onError: (error) => {
      console.error("Failed to update UI locale:", error);
      toast.error(t("errors.generic"));
      // Revert selection back to persisted value.
      const persisted = uiSettingsQuery.data?.locale ?? null;
      setSelectedLocale(persisted ?? "system");
    },
  });
  const restartAppMutation = api.settings.restartApp.useMutation();

  useEffect(() => {
    const persisted = uiSettingsQuery.data?.locale ?? null;
    setSelectedLocale(persisted ?? "system");
  }, [uiSettingsQuery.data?.locale]);

  const handleLaunchAtLoginChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({
      launchAtLogin: checked,
    });
  };

  const handleShowWidgetWhileInactiveChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({
      showWidgetWhileInactive: checked,
    });
  };

  const handleMinimizeToTrayChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({
      minimizeToTray: checked,
    });
  };

  const handleShowInDockChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({
      showInDock: checked,
    });
  };

  const handleMuteSystemAudioChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({
      muteSystemAudio: checked,
    });
  };

  const handleLanguageChange = (value: string) => {
    setSelectedLocale(value);

    const nextLocale = value === "system" ? null : value;
    const currentLocale = uiSettingsQuery.data?.locale ?? null;
    if (nextLocale === currentLocale) {
      return;
    }

    updateUILocaleMutation.mutate({ locale: nextLocale });
  };

  const handleAutoDictateOnNewNoteChange = (checked: boolean) => {
    updatePreferencesMutation.mutate({
      autoDictateOnNewNote: checked,
    });
  };

  const showWidgetWhileInactive =
    preferencesQuery.data?.showWidgetWhileInactive ?? true;
  const minimizeToTray = preferencesQuery.data?.minimizeToTray ?? false;
  const launchAtLogin = preferencesQuery.data?.launchAtLogin ?? true;
  const showInDock = preferencesQuery.data?.showInDock ?? true;
  const muteSystemAudio = preferencesQuery.data?.muteSystemAudio ?? true;
  const autoDictateOnNewNote =
    preferencesQuery.data?.autoDictateOnNewNote ?? false;
  const isMac = window.electronAPI.platform === "darwin";
  const localeDisabled =
    uiSettingsQuery.isLoading || updateUILocaleMutation.isPending;

  return (
    <div>
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.preferences.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.preferences.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            {/* Launch at Login Section */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.preferences.launchAtLogin.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.preferences.launchAtLogin.description")}
                </p>
              </div>
              <Switch
                checked={launchAtLogin}
                onCheckedChange={handleLaunchAtLoginChange}
                disabled={updatePreferencesMutation.isPending}
              />
            </div>

            <Separator />

            {/* Minimize to Tray Section */}
            {/* <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  Minimize to tray
                </Label>
                <p className="text-xs text-muted-foreground">
                  Keep the application running in the system tray when minimized
                </p>
              </div>
              <Switch
                checked={minimizeToTray}
                onCheckedChange={handleMinimizeToTrayChange}
                disabled={updatePreferencesMutation.isPending}
              />
            </div>

            <Separator /> */}

            {/* Show Widget While Inactive Section */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.preferences.showWidgetWhileInactive.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "settings.preferences.showWidgetWhileInactive.description",
                  )}
                </p>
              </div>
              <Switch
                checked={showWidgetWhileInactive}
                onCheckedChange={handleShowWidgetWhileInactiveChange}
                disabled={updatePreferencesMutation.isPending}
              />
            </div>

            <Separator />

            {/* Show in Dock Section (macOS only) */}
            {isMac && (
              <>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-medium text-foreground">
                      {t("settings.preferences.showInDock.label")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.preferences.showInDock.description")}
                    </p>
                  </div>
                  <Switch
                    checked={showInDock}
                    onCheckedChange={handleShowInDockChange}
                    disabled={updatePreferencesMutation.isPending}
                  />
                </div>

                <Separator />
              </>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.preferences.muteSystemAudio.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.preferences.muteSystemAudio.description")}
                </p>
              </div>
              <Switch
                checked={muteSystemAudio}
                onCheckedChange={handleMuteSystemAudioChange}
                disabled={
                  updatePreferencesMutation.isPending ||
                  preferencesQuery.isLoading
                }
              />
            </div>

            <Separator />

            {/* Auto-dictate on new note */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.preferences.autoDictateOnNewNote.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.preferences.autoDictateOnNewNote.description")}
                </p>
              </div>
              <Switch
                checked={autoDictateOnNewNote}
                onCheckedChange={handleAutoDictateOnNewNoteChange}
                disabled={updatePreferencesMutation.isPending}
              />
            </div>

            <Separator />

            {/* Language */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.preferences.language.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.preferences.language.description")}
                </p>
              </div>
              <Select
                value={selectedLocale}
                onValueChange={handleLanguageChange}
                disabled={localeDisabled}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">
                    {t("settings.preferences.language.options.system")}
                  </SelectItem>
                  <SelectItem value="en">
                    {t("settings.preferences.language.options.en")}
                  </SelectItem>
                  <SelectItem value="es">
                    {t("settings.preferences.language.options.es")}
                  </SelectItem>
                  <SelectItem value="ja">
                    {t("settings.preferences.language.options.ja")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Theme Section */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  {t("settings.preferences.theme.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.preferences.theme.description")}
                </p>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        {/* add future preferences here in a card */}
      </div>

      <AlertDialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.preferences.language.restartDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.preferences.language.restartDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                toast.success(
                  t("settings.preferences.language.toast.applyNextStart"),
                );
              }}
            >
              {t("settings.preferences.language.restartDialog.later")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                toast.info(t("settings.preferences.language.toast.restarting"));
                restartAppMutation.mutate();
              }}
              disabled={restartAppMutation.isPending}
            >
              {t("settings.preferences.language.restartDialog.restartNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
