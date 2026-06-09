import type { AppSettingsData } from "../schema";

// v12 -> v13: collapse the legacy single-microphone preference
// (recording.preferredMicrophoneDeviceId / preferredMicrophoneName) onto the
// microphonePriority fallback chain, then drop the legacy fields.
// - A pref WITH a deviceId becomes a proper id-set chain entry.
// - A name-only pref can't be resolved to a deviceId here (the migration runs in
//   the main process, with no device access), so it's stashed as a transient
//   `pendingMicrophoneName` for a renderer to heal into the chain.
// - No pref -> nothing (system default).
export function migrateToV13(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData & {
    recording?: {
      preferredMicrophoneDeviceId?: string;
      preferredMicrophoneName?: string;
      microphonePriority?: { deviceId: string; name: string }[];
      pendingMicrophoneName?: string;
    };
  };

  if (!oldData.recording) {
    return oldData;
  }

  const { preferredMicrophoneDeviceId, preferredMicrophoneName, ...rest } =
    oldData.recording;

  // `rest` already has the legacy fields stripped. Add to it only when there's
  // an unmigrated preference to carry over (an existing chain or no pref -> rest).
  let recording = rest;
  if (!rest.microphonePriority && preferredMicrophoneDeviceId) {
    recording = {
      ...rest,
      microphonePriority: [
        {
          deviceId: preferredMicrophoneDeviceId,
          name: preferredMicrophoneName ?? preferredMicrophoneDeviceId,
        },
      ],
    };
  } else if (!rest.microphonePriority && preferredMicrophoneName) {
    // Name-only: stash for a renderer to heal into the chain once the device is
    // connected (see useHealPendingMicrophone / healPendingMicrophone).
    recording = { ...rest, pendingMicrophoneName: preferredMicrophoneName };
  }

  return { ...oldData, recording };
}
