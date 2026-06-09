import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import {
  DEFAULT_DEVICE_ID,
  resolveActiveMicrophone,
} from "@/utils/audio-devices";
import { useTranslation } from "react-i18next";

/**
 * Simplified microphone selection component for onboarding. Picking a mic seeds
 * a single-entry priority chain (the full fallback ordering lives in settings).
 */
export function OnboardingMicrophoneSelect() {
  const { t } = useTranslation();
  const { data: settings } = api.settings.getSettings.useQuery();
  const setMicrophonePriority =
    api.settings.setMicrophonePriority.useMutation();
  const { devices: audioDevices } = useAudioDevices();

  const handleMicrophoneChange = async (deviceId: string) => {
    const device = audioDevices.find((d) => d.deviceId === deviceId);
    const priority =
      deviceId === DEFAULT_DEVICE_ID || !device
        ? []
        : [{ deviceId, name: device.label }];
    try {
      await setMicrophonePriority.mutateAsync({ priority });
    } catch (error) {
      console.error("Failed to set preferred microphone:", error);
    }
  };

  const currentSelectionValue = resolveActiveMicrophone(
    settings?.recording?.microphonePriority,
    audioDevices,
  );

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
                  {device.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
