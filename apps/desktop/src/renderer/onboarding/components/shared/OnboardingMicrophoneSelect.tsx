import React from "react";
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
import { useTranslation } from "react-i18next";

/**
 * Simplified microphone selection component for onboarding.
 * Sets the selected device as the top priority in the priority list.
 */
export function OnboardingMicrophoneSelect() {
  const { t } = useTranslation();
  const { data: settings } = api.settings.getSettings.useQuery();
  const setMicrophonePriorityList =
    api.settings.setMicrophonePriorityList.useMutation();
  const { devices: audioDevices } = useAudioDevices();

  const priorityList = settings?.recording?.microphonePriorityList ?? [];

  // The current top-priority device, or "default"
  const currentTopDevice =
    priorityList.length > 0
      ? (audioDevices.find((d) => d.label === priorityList[0])?.deviceId ??
        "default")
      : "default";

  const handleMicrophoneChange = async (deviceId: string) => {
    try {
      if (deviceId === "default") {
        // Clear priority list — use system default
        await setMicrophonePriorityList.mutateAsync({ deviceNames: [] });
        return;
      }

      const selected = audioDevices.find(
        (device) => device.deviceId === deviceId,
      );
      if (!selected) return;

      // Move the selected device to the top of the priority list
      const newList = [
        selected.label,
        ...priorityList.filter((name) => name !== selected.label),
      ];
      await setMicrophonePriorityList.mutateAsync({ deviceNames: newList });
    } catch (error) {
      console.error("Failed to set preferred microphone:", error);
    }
  };

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
          value={currentTopDevice}
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
