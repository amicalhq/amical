import type { AppSettingsData } from "../schema";

// v2 -> v3: Auto-enable formatting with amical-cloud for users already on cloud transcription
export function migrateToV3(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  const isCloudSpeech =
    oldData.modelProvidersConfig?.defaultSpeechModel === "amical-cloud";
  const hasNoFormattingModel = !oldData.formatterConfig?.modelId;

  if (isCloudSpeech && hasNoFormattingModel) {
    return {
      ...oldData,
      formatterConfig: {
        ...oldData.formatterConfig,
        enabled: true,
        modelId: "amical-cloud",
      },
    };
  }

  return oldData;
}
