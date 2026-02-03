import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { toast } from "sonner";
import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";

export function MicrophoneSettings() {
  const { t } = useTranslation();
  const { data: settings, refetch: refetchSettings } =
    api.settings.getSettings.useQuery();
  const setPreferredMicrophone =
    api.settings.setPreferredMicrophone.useMutation();
  const { devices: audioDevices } = useAudioDevices();

  const currentMicrophoneName = settings?.recording?.preferredMicrophoneName;

  const handleMicrophoneChange = async (deviceId: string) => {
    try {
      const selected = audioDevices.find(
        (device) => device.deviceId === deviceId,
      );
      const actualDeviceName =
        deviceId === "default" ? null : (selected?.label ?? null);

      await setPreferredMicrophone.mutateAsync({
        deviceName: actualDeviceName,
      });

      // Refetch settings to update UI
      await refetchSettings();

      toast.success(
        actualDeviceName
          ? t("settings.dictation.microphone.toast.changed", {
              deviceName: actualDeviceName,
            })
          : t("settings.dictation.microphone.toast.systemDefault"),
      );
    } catch (error) {
      console.error("Failed to set preferred microphone:", error);
      toast.error(t("settings.dictation.microphone.toast.changeFailed"));
    }
  };

  // Find the current selection value
  const currentSelectionValue = currentMicrophoneName
    ? (audioDevices.find((device) => device.label === currentMicrophoneName)
        ?.deviceId ?? "default")
    : "default";

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-base font-semibold text-foreground">
          {t("settings.dictation.microphone.label")}
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.dictation.microphone.description")}
        </p>
      </div>
      <div className="min-w-[200px]">
        <Select
          value={currentSelectionValue}
          onValueChange={handleMicrophoneChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={t("settings.dictation.microphone.placeholder")}
            />
          </SelectTrigger>
          <SelectContent>
            {audioDevices.length === 0 ? (
              <SelectItem value="no-devices" disabled>
                {t("settings.dictation.microphone.noDevices")}
              </SelectItem>
            ) : (
              audioDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4" />
                    <span>{device.label}</span>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {audioDevices.length === 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.dictation.microphone.noDevicesHelp")}
          </p>
        )}
      </div>
    </div>
  );
}
