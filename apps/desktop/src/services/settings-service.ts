import { FormatterConfig } from "../types/formatter";
import {
  ValidationResult,
  ProviderModel,
  OpenRouterResponse,
  OllamaResponse,
  OpenRouterModel,
  OllamaModel,
} from "../types/providers";
import {
  getSettingsSection,
  updateSettingsSection,
  getAppSettings,
  updateAppSettings,
} from "../db/app-settings";
import {
  getAllProviderModels,
  getProviderModelsByProvider,
  syncProviderModels,
  upsertProviderModel,
  removeProviderModel,
  removeProviderModels,
  modelExists,
} from "../db/provider-models";
import type { AppSettingsData } from "../db/schema";

/**
 * Database-backed settings service with typed configuration
 */
export interface ShortcutsConfig {
  pushToTalk: string;
  toggleRecording: string;
}

export class SettingsService {
  constructor() {}

  /**
   * Get formatter configuration
   */
  async getFormatterConfig(): Promise<FormatterConfig | null> {
    const formatterConfig = await getSettingsSection("formatterConfig");
    return formatterConfig || null;
  }

  /**
   * Set formatter configuration
   */
  async setFormatterConfig(config: FormatterConfig): Promise<void> {
    await updateSettingsSection("formatterConfig", config);
  }

  /**
   * Get all app settings
   */
  async getAllSettings(): Promise<AppSettingsData> {
    return await getAppSettings();
  }

  /**
   * Update multiple settings at once
   */
  async updateSettings(
    settings: Partial<AppSettingsData>,
  ): Promise<AppSettingsData> {
    return await updateAppSettings(settings);
  }

  /**
   * Get UI settings
   */
  async getUISettings(): Promise<AppSettingsData["ui"]> {
    return await getSettingsSection("ui");
  }

  /**
   * Update UI settings
   */
  async setUISettings(uiSettings: AppSettingsData["ui"]): Promise<void> {
    await updateSettingsSection("ui", uiSettings);
  }

  /**
   * Get transcription settings
   */
  async getTranscriptionSettings(): Promise<AppSettingsData["transcription"]> {
    return await getSettingsSection("transcription");
  }

  /**
   * Update transcription settings
   */
  async setTranscriptionSettings(
    transcriptionSettings: AppSettingsData["transcription"],
  ): Promise<void> {
    await updateSettingsSection("transcription", transcriptionSettings);
  }

  /**
   * Get recording settings
   */
  async getRecordingSettings(): Promise<AppSettingsData["recording"]> {
    return await getSettingsSection("recording");
  }

  /**
   * Update recording settings
   */
  async setRecordingSettings(
    recordingSettings: AppSettingsData["recording"],
  ): Promise<void> {
    await updateSettingsSection("recording", recordingSettings);
  }

  /**
   * Get shortcuts configuration with defaults
   */
  async getShortcuts(): Promise<ShortcutsConfig> {
    const shortcuts = await getSettingsSection("shortcuts");
    // Return defaults if not set
    return {
      pushToTalk: shortcuts?.pushToTalk || "Fn",
      toggleRecording: shortcuts?.toggleRecording || "Fn+Space",
    };
  }

  /**
   * Update shortcuts configuration
   */
  async setShortcuts(shortcuts: ShortcutsConfig): Promise<void> {
    // Store empty strings as undefined to clear shortcuts
    const dataToStore = {
      pushToTalk: shortcuts.pushToTalk || undefined,
      toggleRecording: shortcuts.toggleRecording || undefined,
    };
    await updateSettingsSection("shortcuts", dataToStore);
  }

  /**
   * Get model providers configuration
   */
  async getModelProvidersConfig(): Promise<
    AppSettingsData["modelProvidersConfig"]
  > {
    console.log(
      "getModelProvidersConfig",
      await getSettingsSection("modelProvidersConfig"),
    );
    return await getSettingsSection("modelProvidersConfig");
  }

  /**
   * Update model providers configuration
   */
  async setModelProvidersConfig(
    config: AppSettingsData["modelProvidersConfig"],
  ): Promise<void> {
    await updateSettingsSection("modelProvidersConfig", config);
  }

  /**
   * Get OpenRouter configuration
   */
  async getOpenRouterConfig(): Promise<{ apiKey: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.openRouter;
  }

  /**
   * Update OpenRouter configuration
   */
  async setOpenRouterConfig(config: { apiKey: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      openRouter: config,
    });
  }

  /**
   * Get Ollama configuration
   */
  async getOllamaConfig(): Promise<{ url: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.ollama;
  }

  /**
   * Update Ollama configuration
   */
  async setOllamaConfig(config: { url: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();

    // If URL is empty, remove the ollama config entirely
    if (config.url === "") {
      const updatedConfig = { ...currentConfig };
      delete updatedConfig.ollama;
      await this.setModelProvidersConfig(updatedConfig);
    } else {
      await this.setModelProvidersConfig({
        ...currentConfig,
        ollama: config,
      });
    }
  }

  /**
   * Validate OpenRouter connection by testing API key
   */
  async validateOpenRouterConnection(
    apiKey: string,
  ): Promise<ValidationResult> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      console.log(response.json());

      if (!response.ok) {
        return {
          success: false,
          error: `Invalid API key`,
        };
      }

      // If we get here, the API key is valid
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown network error",
      };
    }
  }

  /**
   * Validate Ollama connection by testing URL
   */
  async validateOllamaConnection(url: string): Promise<ValidationResult> {
    try {
      // Remove trailing slash and add /api/tags endpoint
      const cleanUrl = url.replace(/\/$/, "");
      const testUrl = `${cleanUrl}/api/tags`;

      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // If we get here, the Ollama instance is accessible
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown network error",
      };
    }
  }

  /**
   * Fetch available models from OpenRouter
   */
  async fetchOpenRouterModels(apiKey: string): Promise<ProviderModel[]> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: OpenRouterResponse = await response.json();

      // Transform OpenRouter models to unified format
      return data.data.map((model: OpenRouterModel): ProviderModel => {
        const name = model.name.split(":").pop() || model.name;

        // Format context length
        const contextLength = model.context_length
          ? `${Math.floor(model.context_length / 1000)}k`
          : "Unknown";

        return {
          id: model.id,
          name,
          provider: "OpenRouter",
          context: contextLength,
          description: model.description,
          originalModel: model,
        };
      });
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to fetch OpenRouter models",
      );
    }
  }

  /**
   * Fetch available models from Ollama
   */
  async fetchOllamaModels(url: string): Promise<ProviderModel[]> {
    try {
      const cleanUrl = url.replace(/\/$/, "");
      const modelsUrl = `${cleanUrl}/api/tags`;

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: OllamaResponse = await response.json();

      // Transform Ollama models to unified format
      return data.models.map((model: OllamaModel): ProviderModel => {
        // Extract model size from details or calculate from size
        let size = "Unknown";
        if (model.details?.parameter_size) {
          size = model.details.parameter_size;
        } else if (model.size) {
          const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
          size = `${sizeGB}GB`;
        }

        // Extract base model name (remove tags like :latest)
        const baseName = model.name.split(":")[0];
        const displayName =
          baseName.charAt(0).toUpperCase() + baseName.slice(1);

        // Estimate context length (most Ollama models have 4k-32k context)
        const lowerName = model.name.toLowerCase();
        let contextLength = "4k"; // Default
        if (lowerName.includes("32k") || lowerName.includes("32000"))
          contextLength = "32k";
        else if (lowerName.includes("16k") || lowerName.includes("16000"))
          contextLength = "16k";
        else if (lowerName.includes("8k") || lowerName.includes("8000"))
          contextLength = "8k";

        return {
          id: model.name,
          name: displayName,
          provider: "Ollama",
          size,
          context: contextLength,
          description: model.details?.family || undefined,
          originalModel: model,
        };
      });
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to fetch Ollama models",
      );
    }
  }

  /**
   * Get all synced provider models from database
   */
  async getSyncedProviderModels(): Promise<ProviderModel[]> {
    return await getAllProviderModels();
  }

  /**
   * Get synced models by provider
   */
  async getSyncedModelsByProvider(provider: string): Promise<ProviderModel[]> {
    return await getProviderModelsByProvider(provider);
  }

  /**
   * Sync provider models to database (replace all models for a provider)
   */
  async syncProviderModelsToDatabase(
    provider: string,
    models: ProviderModel[],
  ): Promise<void> {
    await syncProviderModels(provider, models);
  }

  /**
   * Add or update a single provider model
   */
  async upsertProviderModel(model: ProviderModel): Promise<void> {
    await upsertProviderModel(model);
  }

  /**
   * Remove a provider model
   */
  async removeProviderModel(modelId: string): Promise<void> {
    await removeProviderModel(modelId);
  }

  /**
   * Remove all models for a provider
   */
  async removeProviderModels(provider: string): Promise<void> {
    await removeProviderModels(provider);
  }

  /**
   * Check if a model exists in database
   */
  async modelExists(modelId: string): Promise<boolean> {
    return await modelExists(modelId);
  }

  /**
   * Get default language model
   */
  async getDefaultLanguageModel(): Promise<string | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.defaultLanguageModel || "";
  }

  /**
   * Set default language model
   */
  async setDefaultLanguageModel(modelId: string | undefined): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      defaultLanguageModel: modelId,
    });
  }

  /**
   * Get default embedding model
   */
  async getDefaultEmbeddingModel(): Promise<string | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.defaultEmbeddingModel || "";
  }

  /**
   * Set default embedding model
   */
  async setDefaultEmbeddingModel(modelId: string | undefined): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      defaultEmbeddingModel: modelId,
    });
  }

  /**
   * Remove OpenRouter provider completely
   */
  async removeOpenRouterProvider(): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    const currentDefault = currentConfig?.defaultLanguageModel;

    // Get all OpenRouter models that will be removed
    const allModels = await getAllProviderModels();
    const openRouterModels = allModels.filter(
      (m) => m.provider === "OpenRouter",
    );

    // Remove all OpenRouter models from database
    for (const model of openRouterModels) {
      await removeProviderModel(model.id);
    }

    // Clear default if it's an OpenRouter model
    let newDefaultModel = currentDefault;
    if (
      currentDefault &&
      openRouterModels.some((m) => m.id === currentDefault)
    ) {
      newDefaultModel = "";
    }

    // Remove OpenRouter config entirely
    const updatedConfig = { ...currentConfig };
    delete updatedConfig.openRouter;
    updatedConfig.defaultLanguageModel = newDefaultModel;

    await this.setModelProvidersConfig(updatedConfig);
  }

  /**
   * Remove Ollama provider completely
   */
  async removeOllamaProvider(): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    const currentDefaultLanguage = currentConfig?.defaultLanguageModel;
    const currentDefaultEmbedding = currentConfig?.defaultEmbeddingModel;

    // Get all Ollama models that will be removed
    const allModels = await getAllProviderModels();
    const ollamaModels = allModels.filter((m) => m.provider === "Ollama");

    // Remove all Ollama models from database
    for (const model of ollamaModels) {
      await removeProviderModel(model.id);
    }

    // Clear defaults if they're Ollama models
    let newDefaultLanguage = currentDefaultLanguage;
    let newDefaultEmbedding = currentDefaultEmbedding;

    if (
      currentDefaultLanguage &&
      ollamaModels.some((m) => m.id === currentDefaultLanguage)
    ) {
      newDefaultLanguage = undefined;
    }

    if (
      currentDefaultEmbedding &&
      ollamaModels.some((m) => m.id === currentDefaultEmbedding)
    ) {
      newDefaultEmbedding = undefined;
    }

    // Remove Ollama config entirely
    const updatedConfig = { ...currentConfig };
    updatedConfig.ollama = undefined;
    updatedConfig.defaultLanguageModel = newDefaultLanguage;
    updatedConfig.defaultEmbeddingModel = newDefaultEmbedding;

    await this.setModelProvidersConfig(updatedConfig);
  }
}
