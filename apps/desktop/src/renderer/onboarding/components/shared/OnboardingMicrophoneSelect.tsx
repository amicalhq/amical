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

/**
 * Simplified microphone selection component for onboarding
 */
export function OnboardingMicrophoneSelect() {
  const { data: settings } = api.settings.getSettings.useQuery();
  const setPreferredMicrophone =
    api.settings.setPreferredMicrophone.useMutation();
  const { devices: audioDevices } = useAudioDevices();

  const currentMicrophoneName = settings?.recording?.preferredMicrophoneName;

  const handleMicrophoneChange = async (deviceName: string) => {
    try {
      // If "System Default" is selected, store null to follow system default
      const actualDeviceName = deviceName.startsWith("System Default")
        ? null
        : deviceName;

      await setPreferredMicrophone.mutateAsync({
        deviceName: actualDeviceName,
      });
    } catch (error) {
      console.error("Failed to set preferred microphone:", error);
    }
  };

  // Find the current selection value
  const currentSelectionValue =
    currentMicrophoneName &&
    audioDevices.some((device) => device.label === currentMicrophoneName)
      ? currentMicrophoneName
      : audioDevices.find((d) => d.isDefault)?.label || "";

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-base font-semibold text-foreground">
          Microphone
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Choose your preferred microphone.
        </p>
      </div>
      <div className="min-w-[200px]">
        <Select
          value={currentSelectionValue}
          onValueChange={handleMicrophoneChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a microphone" />
          </SelectTrigger>
          <SelectContent>
            {audioDevices.length === 0 ? (
              <SelectItem value="no-devices" disabled>
                No microphones available
              </SelectItem>
            ) : (
              audioDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.label}>
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
