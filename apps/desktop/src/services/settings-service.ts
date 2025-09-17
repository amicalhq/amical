import { app } from "electron";
import { FormatterConfig } from "../types/formatter";
import {
  getSettingsSection,
  updateSettingsSection,
  getAppSettings,
  updateAppSettings,
} from "../db/app-settings";
import type { AppSettingsData } from "../db/schema";
import { isMacOS } from "../utils/platform";

/**
 * Database-backed settings service with typed configuration
 */
export interface ShortcutsConfig {
  pushToTalk: string;
  toggleRecording: string;
}

export interface AppPreferences {
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  showWidgetWhileInactive: boolean;
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
    return (
      (await getSettingsSection("ui")) ?? {
        theme: "system",
      }
    );
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
   * Get dictation settings
   */
  async getDictationSettings(): Promise<AppSettingsData["dictation"]> {
    return await getSettingsSection("dictation");
  }

  /**
   * Update dictation settings
   */
  async setDictationSettings(
    dictationSettings: AppSettingsData["dictation"],
  ): Promise<void> {
    await updateSettingsSection("dictation", dictationSettings);
  }

  /**
   * Get shortcuts configuration with defaults
   */
  async getShortcuts(): Promise<ShortcutsConfig> {
    const shortcuts = await getSettingsSection("shortcuts");
    // Return platform-specific defaults if not set
    const defaults = isMacOS()
      ? { pushToTalk: "Fn", toggleRecording: "Fn+Space" }
      : { pushToTalk: "Ctrl+Win", toggleRecording: "Ctrl+Win+Space" };

    return {
      pushToTalk: shortcuts?.pushToTalk || defaults.pushToTalk,
      toggleRecording: shortcuts?.toggleRecording || defaults.toggleRecording,
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
   * Get default speech model (Whisper)
   */
  async getDefaultSpeechModel(): Promise<string | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.defaultSpeechModel;
  }

  /**
   * Set default speech model (Whisper)
   */
  async setDefaultSpeechModel(modelId: string | undefined): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      defaultSpeechModel: modelId,
    });
  }

  /**
   * Get default language model
   */
  async getDefaultLanguageModel(): Promise<string | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.defaultLanguageModel;
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
    return config?.defaultEmbeddingModel;
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
   * Get app preferences (launch at login, minimize to tray, etc.)
   */
  async getPreferences(): Promise<AppPreferences> {
    const preferences = await getSettingsSection("preferences");
    return {
      launchAtLogin: preferences?.launchAtLogin ?? true,
      minimizeToTray: preferences?.minimizeToTray ?? true,
      showWidgetWhileInactive: preferences?.showWidgetWhileInactive ?? true,
    };
  }

  /**
   * Set app preferences and handle side effects
   */
  async setPreferences(preferences: Partial<AppPreferences>): Promise<void> {
    const currentPreferences = await this.getPreferences();
    const newPreferences = { ...currentPreferences, ...preferences };

    // Save to database
    await updateSettingsSection("preferences", newPreferences);

    // Handle launch at login change
    if (
      preferences.launchAtLogin !== undefined &&
      preferences.launchAtLogin !== currentPreferences.launchAtLogin
    ) {
      this.syncAutoLaunch();
    }
  }

  /**
   * Sync the auto-launch setting with the OS
   * This ensures the OS setting matches our stored preference
   */
  syncAutoLaunch(): void {
    // Get the current preference asynchronously and apply it
    this.getPreferences().then((preferences) => {
      app.setLoginItemSettings({
        openAtLogin: preferences.launchAtLogin,
        openAsHidden: false,
      });
    });
  }

  /**
   * Get telemetry settings
   */
  async getTelemetrySettings(): Promise<AppSettingsData["telemetry"]> {
    const telemetry = await getSettingsSection("telemetry");
    return telemetry ?? { enabled: true }; // Default to enabled
  }

  /**
   * Update telemetry settings
   */
  async setTelemetrySettings(
    telemetrySettings: AppSettingsData["telemetry"],
  ): Promise<void> {
    await updateSettingsSection("telemetry", telemetrySettings);
  }
}
