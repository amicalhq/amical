import type { AppSettingsData } from "../schema";

// v7 -> v8: ensure dictation settings exist with auto-detect enabled by default
export function migrateToV8(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  const existingDictation = oldData.dictation;
  const selectedLanguage = existingDictation?.selectedLanguage ?? "en";

  return {
    ...oldData,
    dictation: {
      autoDetectEnabled: existingDictation?.autoDetectEnabled ?? true,
      // Normalize invalid legacy value; selectedLanguage is always concrete.
      selectedLanguage: selectedLanguage === "auto" ? "en" : selectedLanguage,
    },
  };
}
