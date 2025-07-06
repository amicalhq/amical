import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GeneralSettings } from "./GeneralSettings";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { FormatterSettings } from "./FormatterSettings";
import { AdvancedSettings } from "./AdvancedSettings";

export function SettingsManager() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="microphone">Microphone</TabsTrigger>
          <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          <TabsTrigger value="formatter">Formatter</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="microphone" className="space-y-6">
          <MicrophoneSettings />
        </TabsContent>

        <TabsContent value="shortcuts" className="space-y-6">
          <ShortcutsSettings />
        </TabsContent>

        <TabsContent value="formatter" className="space-y-6">
          <FormatterSettings />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-6">
          <AdvancedSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
