import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { resolveActiveMicrophone } from "@/utils/audio-devices";
import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MicrophoneDialog } from "./MicrophoneDialog";

export function MicrophoneSettings() {
  const { t } = useTranslation();
  const { data: settings } = api.settings.getSettings.useQuery();
  const { devices: audioDevices } = useAudioDevices();
  const [dialogOpen, setDialogOpen] = useState(false);

  const activeDeviceId = resolveActiveMicrophone(
    settings?.recording?.microphonePriority,
    audioDevices,
  );
  const currentLabel =
    audioDevices.find((device) => device.deviceId === activeDeviceId)?.label ??
    t("settings.dictation.microphone.systemDefault");

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-base font-semibold text-foreground">
          {t("settings.dictation.microphone.label")}
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.dictation.microphone.description")}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => setDialogOpen(true)}
        className="min-w-[200px] max-w-[60%] justify-start gap-2"
      >
        <Mic className="h-4 w-4 shrink-0" />
        <span className="truncate">{currentLabel}</span>
      </Button>
      <MicrophoneDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
