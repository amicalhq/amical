import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { MicrophoneSettings } from "../dictation/components";
import { KeyboardShortcutsCard } from "../shortcuts/KeyboardShortcutsCard";
import { AdvancedSettingsContent } from "../advanced/AdvancedSettingsContent";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PreferencesSettingsPage() {
  const utils = api.useUtils();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // tRPC queries and mutations
  const preferencesQuery = api.settings.getPreferences.useQuery();
  const updatePreferencesMutation = api.settings.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("Settings updated");
      utils.settings.getPreferences.invalidate();
    },
    onError: (error) => {
      console.error("Failed to update preferences:", error);
      toast.error("Failed to update settings. Please try again.");
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
    <div className="container mx-auto max-w-5xl px-6 pb-6">
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <div className="space-y-10">
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">
            Microphone
          </h2>
          <Card>
            <CardContent>
              <MicrophoneSettings />
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">
            Keyboard Shortcuts
          </h2>
          <KeyboardShortcutsCard />
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">
            Application
          </h2>
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

                {/* Auto Updates Section */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label
                      htmlFor="auto-update"
                      className="text-base font-medium text-foreground"
                    >
                      Auto Updates
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically check for updates
                    </p>
                  </div>
                  <Switch id="auto-update" defaultChecked />
                </div>

                <Separator />

                {/* Theme Section */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-medium text-foreground">
                      Theme
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Dark mode only for now. More themes coming soon.
                    </p>
                  </div>
                  <ThemeToggle />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-4">
          <Collapsible
            open={isAdvancedOpen}
            onOpenChange={setIsAdvancedOpen}
            className="space-y-4"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 text-left"
              >
                <h2 className="text-base font-semibold text-foreground">
                  Advanced settings
                </h2>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isAdvancedOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <AdvancedSettingsContent showHeader={false} />
            </CollapsibleContent>
          </Collapsible>
        </section>
      </div>
    </div>
  );
}
