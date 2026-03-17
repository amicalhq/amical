import type { AppSettingsData } from "../schema";

// v9 -> v10: add keepTranscriptInClipboard preference
export function migrateToV10(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  const preferences = oldData.preferences ?? {};

  return {
    ...oldData,
    preferences: {
      ...preferences,
      keepTranscriptInClipboard: false,
    },
  };
}
