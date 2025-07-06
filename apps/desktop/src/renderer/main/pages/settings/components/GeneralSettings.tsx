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
import { ThemeToggle } from "@/components/theme-toggle";

export function GeneralSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>General Settings</CardTitle>
        <CardDescription>Configure your general preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="launch-login">Launch at Login</Label>
            <p className="text-sm text-muted-foreground">
              Start Amical when you log in
            </p>
          </div>
          <Switch id="launch-login" />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="minimize-tray">Minimize to Tray</Label>
            <p className="text-sm text-muted-foreground">
              Keep running in system tray when closed
            </p>
          </div>
          <Switch id="minimize-tray" />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="theme-toggle">Theme</Label>
            <p className="text-sm text-muted-foreground">
              Choose your preferred theme
            </p>
          </div>
          <ThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}
