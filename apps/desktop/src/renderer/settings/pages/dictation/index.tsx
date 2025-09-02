import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  LanguageSettings,
  MicrophoneSettings,
  SpeechToTextSettings,
  FormattingSettings,
} from "./components";

// Mock data - TODO: Move to a shared constants file
const speechModelOptions = [
  { value: "whisper", label: "OpenAI Whisper" },
  { value: "google-speech", label: "Google Speech-to-Text" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "deepgram", label: "Deepgram" },
];

export default function DictationSettingsPage() {
  // State
  const [autoDetect, setAutoDetect] = useState(true);
  const [languages, setLanguages] = useState<string[]>([]);
  // Separate model lists for each section
  const [speechModels] = useState(speechModelOptions); // set to [] to test empty state
  const [speechModel, setSpeechModel] = useState<string>(
    speechModels[0]?.value || "",
  );

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Dictation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure dictation, language, microphone, and AI model settings
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          <LanguageSettings
            autoDetect={autoDetect}
            onAutoDetectChange={setAutoDetect}
            languages={languages}
            onLanguagesChange={setLanguages}
          />
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
