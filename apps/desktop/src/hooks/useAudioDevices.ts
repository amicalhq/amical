import { useState, useEffect, useCallback } from "react";

export interface AudioDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

export function useAudioDevices() {
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
          device.label.toLowerCase().startsWith("default"),
      );

      if (defaultDevice) {
        // Extract the actual device name from "Default - DeviceName" or "Default (DeviceName)"
        const match = defaultDevice.label.match(
          /Default\s*[-–]\s*(.+)|Default\s*\((.+)\)/i,
        );
        if (match) {
          foundDefaultName = match[1] || match[2] || "";
        }
      }

      // Filter and deduplicate audio inputs
      const seenDeviceIds = new Set<string>();
      const audioInputs = allDevices
        .filter((device) => device.kind === "audioinput")
        .filter((device) => {
          // Skip virtual devices
          const lowerLabel = device.label.toLowerCase();
          if (
            lowerLabel.includes("virtual") ||
            lowerLabel.includes("teams") ||
            lowerLabel.includes("zoom") ||
            lowerLabel.includes("discord")
          ) {
            return false;
          }

          // Skip "Default" entries entirely - we'll add our own
          if (lowerLabel.startsWith("default")) {
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
          deviceId: "default",
          label: foundDefaultName
            ? `System Default (${foundDefaultName})`
            : "System Default",
          isDefault: true,
        },
        ...audioInputs,
      ];

      setDevices(devicesWithDefault);
      setDefaultDeviceName(foundDefaultName);
    } catch (error) {
      console.error("Failed to fetch audio devices:", error);
    }
  }, []);

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
