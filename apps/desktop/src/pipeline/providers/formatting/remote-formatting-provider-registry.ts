import type { FormattingProvider } from "../../core/pipeline-types";
import {
  PROVIDER_TYPES,
  type ProviderType,
} from "../../../constants/provider-types";
import type { SettingsService } from "../../../services/settings-service";
import { OllamaFormatter } from "./ollama-formatter";
import { OpenAICompatibleFormatter } from "./openai-compatible-formatter";
import { OpenRouterProvider } from "./openrouter-formatter";

export type RemoteFormattingProviderType = Extract<
  ProviderType,
  | typeof PROVIDER_TYPES.openRouter
  | typeof PROVIDER_TYPES.ollama
  | typeof PROVIDER_TYPES.openAICompatible
>;

const registry: {
  [K in RemoteFormattingProviderType]: (
    settingsService: SettingsService,
    modelId: string,
  ) => Promise<FormattingProvider | null>;
} = {
  [PROVIDER_TYPES.openRouter]: async (settingsService, modelId) => {
    const config = await settingsService.getOpenRouterConfig();
    if (!config?.apiKey) {
      return null;
    }

    return new OpenRouterProvider(config.apiKey, modelId);
  },
  [PROVIDER_TYPES.ollama]: async (settingsService, modelId) => {
    const config = await settingsService.getOllamaConfig();
    if (!config?.url) {
      return null;
    }

    return new OllamaFormatter(config.url, modelId);
  },
  [PROVIDER_TYPES.openAICompatible]: async (settingsService, modelId) => {
    const config = await settingsService.getOpenAICompatibleConfig();
    if (!config?.apiKey || !config?.baseURL) {
      return null;
    }

    return new OpenAICompatibleFormatter(
      config.apiKey,
      config.baseURL,
      modelId,
    );
  },
};

export async function createRemoteFormattingProvider(
  settingsService: SettingsService,
  provider: RemoteFormattingProviderType,
  modelId: string,
) {
  return registry[provider](settingsService, modelId);
}
