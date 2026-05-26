import type { AppSettingsData } from "../schema";

// v11 -> v12: dictation.selectedLanguage (string) -> dictation.languages (string[])
export function migrateToV12(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData & {
    dictation?: { autoDetectEnabled?: boolean; selectedLanguage?: string };
  };
  const old = oldData.dictation;
  const language = old?.selectedLanguage || "en";

  return {
    ...oldData,
    dictation: {
      autoDetectEnabled: old?.autoDetectEnabled ?? true,
      languages: [language],
    },
  };
}
