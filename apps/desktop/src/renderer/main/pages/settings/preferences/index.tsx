import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { MicrophoneSettings } from "../dictation/components";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export default function PreferencesSettingsPage() {
  const utils = api.useUtils();

  // tRPC queries and mutations
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const updatePreferencesMutation = api.settings.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("Preferences updated");
      utils.settings.getPreferences.invalidate();
    },
    onError: (error) => {
      console.error("Failed to update preferences:", error);
      toast.error("Failed to update preferences. Please try again.");
    },
  });

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

  const showWidgetWhileInactive =
    preferencesQuery.data?.showWidgetWhileInactive ?? true;
  const minimizeToTray = preferencesQuery.data?.minimizeToTray ?? false;
  const launchAtLogin = preferencesQuery.data?.launchAtLogin ?? true;
  const showInDock = preferencesQuery.data?.showInDock ?? true;
  const isMac = window.electronAPI.platform === "darwin";

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">Preferences</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Customize your application behavior and appearance
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            {/* Launch at Login Section */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  Launch at login
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically start the application when you log in
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
                  Show widget while inactive
                </Label>
                <p className="text-xs text-muted-foreground">
                  Keep the widget visible on screen when not recording
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
                      Show app in dock
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Display the application icon in the macOS dock
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

            {/* Theme Section */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium text-foreground">
                  Theme
                </Label>
                <p className="text-xs text-muted-foreground">
                  Choose your preferred color scheme
                </p>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        {/* Microphone settings */}
        <Card>
          <CardContent>
            <MicrophoneSettings />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
