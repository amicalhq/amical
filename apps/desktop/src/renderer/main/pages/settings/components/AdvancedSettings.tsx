import React from "react";
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

export function AdvancedSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Advanced Settings</CardTitle>
        <CardDescription>Advanced configuration options</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
  );
}
