export interface AudioDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

/** Sentinel deviceId for the system-default microphone (matches the id the
 * MediaDevices API uses for the default device). */
export const DEFAULT_DEVICE_ID = "default";

/** A single entry in the microphone fallback chain. `name` is only a display
 * label for when the device is disconnected — matching is always by `deviceId`. */
export interface MicrophonePriorityEntry {
  deviceId: string;
  name: string;
}

/**
 * Find the connected device for a priority entry, by deviceId. Matching is
 * id-only so it stays consistent with `mergeConnectedMicrophones` (which dedupes
 * by id): a device whose id changed is treated as a new device rather than
 * silently merged. Generic over the curated UI list (`AudioDevice[]`) and the
 * raw `MediaDeviceInfo[]` from `enumerateDevices`.
 */
export function findConnectedMicrophone<T extends { deviceId: string }>(
  entry: MicrophonePriorityEntry,
  connected: T[],
): T | undefined {
  return connected.find((device) => device.deviceId === entry.deviceId);
}

/**
 * Resolve the active microphone deviceId from a priority chain: the
 * highest-ranked entry that is currently connected. The system default is
 * always available, so this always returns a usable deviceId.
 */
export function resolveActiveMicrophone<T extends { deviceId: string }>(
  priority: MicrophonePriorityEntry[] | undefined,
  connected: T[],
): string {
  for (const entry of priority ?? []) {
    const match = findConnectedMicrophone(entry, connected);
    if (match) return match.deviceId;
  }
  return DEFAULT_DEVICE_ID;
}

/**
 * Promote a connected microphone to the top of the *connected* mics: slot it
 * just above the current active mic (the highest-ranked connected entry) so it
 * becomes active, without leap-frogging higher-ranked disconnected entries that
 * should reclaim priority when they reconnect.
 */
export function promoteAmongConnected<T extends { deviceId: string }>(
  priority: MicrophonePriorityEntry[],
  entry: MicrophonePriorityEntry,
  connected: T[],
): MicrophonePriorityEntry[] {
  const activeIndex = priority.findIndex((e) =>
    findConnectedMicrophone(e, connected),
  );
  const target = activeIndex < 0 ? 0 : activeIndex;
  const fromIndex = priority.findIndex((e) => e.deviceId === entry.deviceId);
  if (fromIndex < 0 || fromIndex === target) return priority;

  const next = priority.slice();
  next.splice(fromIndex, 1);
  next.splice(target, 0, entry);
  return next;
}

/**
 * Ensure every connected device appears in the priority list, appending
 * newly-seen devices at the bottom while preserving existing rank.
 */
export function mergeConnectedMicrophones(
  priority: MicrophonePriorityEntry[],
  connected: AudioDevice[],
): MicrophonePriorityEntry[] {
  const known = new Set(priority.map((entry) => entry.deviceId));
  const appended = connected
    .filter((device) => !known.has(device.deviceId))
    .map((device) => ({ deviceId: device.deviceId, name: device.label }));
  return [...priority, ...appended];
}

/**
 * TEMPORARY (v13 heal — remove once the name-only population has aged out, a
 * couple releases after the priority-chain release): resolve a pending name-only
 * legacy preference (`recording.pendingMicrophoneName`, which the migration
 * couldn't give a deviceId) into the chain, by matching the stored name against
 * a connected device. Returns the chain to persist with the healed entry
 * prepended as top priority — persisting also clears the pending value — or
 * `null` when there's nothing to do (no pending value, or its device isn't
 * connected). Keeps `microphonePriority` entries always id-set.
 */
export function healPendingMicrophone(
  priority: MicrophonePriorityEntry[],
  pendingName: string | undefined,
  connected: AudioDevice[],
): MicrophonePriorityEntry[] | null {
  if (!pendingName) return null;
  const match = connected.find((device) => device.label === pendingName);
  if (!match) return null;
  if (priority.some((entry) => entry.deviceId === match.deviceId)) {
    return priority; // already ranked; persist only to clear the pending value
  }
  return [{ deviceId: match.deviceId, name: match.label }, ...priority];
}
