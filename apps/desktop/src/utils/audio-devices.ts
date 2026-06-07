export interface AudioDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

/** Sentinel deviceId for the system-default microphone (matches the id the
 * MediaDevices API uses for the default device). */
export const DEFAULT_DEVICE_ID = "default";

/**
 * Match a saved microphone preference against a device list. A saved deviceId is
 * authoritative; label matching is only a legacy fallback for old settings that
 * did not store a deviceId. Generic over the curated UI list (`AudioDevice[]`)
 * and the raw `MediaDeviceInfo[]` from `enumerateDevices`.
 */
export function resolvePreferredAudioDevice<
  T extends { deviceId: string; label: string },
>(
  devices: T[],
  preferredDeviceId: string | null | undefined,
  preferredName: string | null | undefined,
): { device?: T; matchedBy: "deviceId" | "label" | "none" } {
  if (preferredDeviceId) {
    const device = devices.find((d) => d.deviceId === preferredDeviceId);
    return { device, matchedBy: device ? "deviceId" : "none" };
  }

  if (preferredName) {
    const device = devices.find((d) => d.label === preferredName);
    return { device, matchedBy: device ? "label" : "none" };
  }

  return { matchedBy: "none" };
}

/**
 * Resolve which option a microphone <Select> should show as selected, falling
 * back to the system default when no saved preference matches.
 */
export function resolveMicrophoneSelectionValue(
  audioDevices: AudioDevice[],
  preferredDeviceId: string | null | undefined,
  preferredName: string | null | undefined,
): string {
  return (
    resolvePreferredAudioDevice(audioDevices, preferredDeviceId, preferredName)
      .device?.deviceId ?? DEFAULT_DEVICE_ID
  );
}

/**
 * Convert a microphone <Select> value into the preference to persist. The
 * system-default option is stored as nulls (i.e. no saved preference).
 */
export function toMicrophonePreference(
  selectedDeviceId: string,
  audioDevices: AudioDevice[],
): { deviceId: string | null; deviceName: string | null } {
  if (selectedDeviceId === DEFAULT_DEVICE_ID) {
    return { deviceId: null, deviceName: null };
  }
  const selected = audioDevices.find(
    (device) => device.deviceId === selectedDeviceId,
  );
  return { deviceId: selectedDeviceId, deviceName: selected?.label ?? null };
}
