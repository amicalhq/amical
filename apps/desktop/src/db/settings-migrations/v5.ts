import type { AppSettingsData } from "../schema";

// v4 -> v5: Default muteSystemAudio to preferences (default true)
export function migrateToV5(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  return {
    ...oldData,
    preferences: {
      ...(oldData.preferences ?? {}),
      muteSystemAudio: oldData.preferences?.muteSystemAudio ?? true,
    },
  };
}
