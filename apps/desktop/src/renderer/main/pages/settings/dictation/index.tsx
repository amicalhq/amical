import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  LanguageSettings,
  MicrophoneSettings,
  FormattingSettings,
} from "./components";
import { useTranslation } from "react-i18next";

export default function DictationSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.dictation.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.dictation.description")}
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
