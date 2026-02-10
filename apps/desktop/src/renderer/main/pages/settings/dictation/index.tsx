import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  LanguageSettings,
  MicrophoneSettings,
  FormattingSettings,
} from "./components";

export default function DictationSettingsPage() {
  return (
    <div className="container mx-auto max-w-5xl px-6 pb-6">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Dictation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure dictation, language, microphone, and AI model settings
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          <LanguageSettings />
          <Separator />
          <MicrophoneSettings />
          <Separator />
          {/* <SpeechToTextSettings
            speechModels={speechModels}
            speechModel={speechModel}
            onSpeechModelChange={setSpeechModel}
          />
          <Separator /> */}
          <FormattingSettings />
        </CardContent>
      </Card>
    </div>
  );
}
