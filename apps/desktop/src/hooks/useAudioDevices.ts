import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { type AudioDevice, DEFAULT_DEVICE_ID } from "@/utils/audio-devices";

export function useAudioDevices() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [defaultDeviceName, setDefaultDeviceName] = useState<string>("");

  const fetchDevices = useCallback(async () => {
    if (!navigator.mediaDevices) {
      console.warn("Media devices API not available");
      return;
    }

    try {
      // Request permissions if needed by getting a stream
      // This ensures device labels are available
      const stream = await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .catch(() => null);

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      // Enumerate devices
      const allDevices = await navigator.mediaDevices.enumerateDevices();

      // Find the default device name
      let foundDefaultName = "";
      const defaultDevice = allDevices.find(
        (device) =>
          device.kind === "audioinput" &&
          device.deviceId === DEFAULT_DEVICE_ID,
      );

      if (defaultDevice) {
        const label = defaultDevice.label || "";

        // Extract the actual device name from common patterns like:
        // "Default - DeviceName" or "Default (DeviceName)".
        const match = label.match(/Default\s*[-–]\s*(.+)|Default\s*\((.+)\)/i);
        if (match) {
          foundDefaultName = (match[1] || match[2] || "").trim();
        } else if (label.includes("-")) {
          // Fallback for non-English environments that still include a dash separator.
          foundDefaultName = label.split("-").slice(1).join("-").trim();
        } else {
          const paren = label.match(/\((.+)\)/);
          if (paren) {
            foundDefaultName = (paren[1] || "").trim();
          }
        }
      }

      // Filter and deduplicate audio inputs
      const seenDeviceIds = new Set<string>();
      const audioInputs = allDevices
        .filter((device) => device.kind === "audioinput")
        .filter((device) => {
          // Skip special entries entirely - we'll add our own.
          if (
            device.deviceId === DEFAULT_DEVICE_ID ||
            device.deviceId === "communications"
          ) {
            return false;
          }

          // Skip duplicate device IDs
          if (seenDeviceIds.has(device.deviceId)) {
            return false;
          }
          seenDeviceIds.add(device.deviceId);

          return true;
        })
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
        }));

      // Add system default as first option
      const devicesWithDefault: AudioDevice[] = [
        {
          deviceId: DEFAULT_DEVICE_ID,
          label: foundDefaultName
            ? t("settings.dictation.microphone.systemDefaultWithName", {
                deviceName: foundDefaultName,
              })
            : t("settings.dictation.microphone.systemDefault"),
          isDefault: true,
        },
        ...audioInputs,
      ];

      setDevices(devicesWithDefault);
      setDefaultDeviceName(foundDefaultName);
    } catch (error) {
      console.error("Failed to fetch audio devices:", error);
    }
  }, [t]);

  useEffect(() => {
    fetchDevices();

    // Set up device change listener
    const handleDeviceChange = () => {
      console.log("Audio devices changed");
      fetchDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [fetchDevices]);

  return { devices, defaultDeviceName, refetch: fetchDevices };
}
