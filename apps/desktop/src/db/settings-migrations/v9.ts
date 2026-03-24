import type { AppSettingsData } from "../schema";
import { getSpeechModelSelectionKey } from "../../utils/model-selection";

export function migrateToV9(data: unknown): AppSettingsData {
  const oldData = (data as AppSettingsData) || {};
  const modelProvidersConfig = oldData.modelProvidersConfig || {};
  const formatterConfig = oldData.formatterConfig;

  const defaultSpeechModel = modelProvidersConfig.defaultSpeechModel
    ? getSpeechModelSelectionKey(modelProvidersConfig.defaultSpeechModel)
    : modelProvidersConfig.defaultSpeechModel;

  const modelId =
    formatterConfig?.modelId === "amical-cloud"
      ? getSpeechModelSelectionKey("amical-cloud")
      : formatterConfig?.modelId;

  const fallbackModelId =
    formatterConfig?.fallbackModelId === "amical-cloud"
      ? getSpeechModelSelectionKey("amical-cloud")
      : formatterConfig?.fallbackModelId;

  return {
    ...oldData,
    formatterConfig: formatterConfig
      ? {
          ...formatterConfig,
          modelId,
          fallbackModelId,
        }
      : formatterConfig,
    modelProvidersConfig: {
      ...modelProvidersConfig,
      defaultSpeechModel,
    },
  };
}
