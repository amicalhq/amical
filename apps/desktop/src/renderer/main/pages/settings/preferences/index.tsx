import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export default function PreferencesSettingsPage() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);

  // tRPC queries and mutations
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const updatePreferencesMutation = api.settings.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("Preferences updated");
    },
    onError: (error) => {
      console.error("Failed to update preferences:", error);
      toast.error("Failed to update preferences. Please try again.");
    },
  });

  // Load preferences when query data is available
  useEffect(() => {
    if (preferencesQuery.data) {
      setLaunchAtLogin(preferencesQuery.data.launchAtLogin);
      setMinimizeToTray(preferencesQuery.data.minimizeToTray);
    }
  }, [preferencesQuery.data]);

  const handleLaunchAtLoginChange = (checked: boolean) => {
    setLaunchAtLogin(checked);
    updatePreferencesMutation.mutate({
      launchAtLogin: checked,
    });
  };

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
            <div className="flex items-center justify-between">
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
                onCheckedChange={setMinimizeToTray}
              />
            </div>

            <Separator />

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

        {/* add future preferences here in a card */}
      </div>
    </div>
  );
}
