import { app } from "electron";
import { EventEmitter } from "events";
import { FormatterConfig } from "../types/formatter";
import {
  getSettingsSection,
  updateSettingsSection,
  getAppSettings,
  updateAppSettings,
} from "../db/app-settings";
import type { AppSettingsData, ModeConfig } from "../db/schema";

/**
 * Database-backed settings service with typed configuration
 */
export interface ShortcutsConfig {
  pushToTalk: string[];
  toggleRecording: string[];
}

export interface AppPreferences {
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  showWidgetWhileInactive: boolean;
  showInDock: boolean;
}

export class SettingsService extends EventEmitter {
  constructor() {
    super();
  }

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

    // Emit event if theme changed (AppManager will handle window updates)
    if (uiSettings?.theme !== undefined) {
      this.emit("theme-changed", { theme: uiSettings.theme });
    }
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
   * Get shortcuts configuration
   * Defaults are handled by app-settings.ts during initialization/migration
   */
  async getShortcuts(): Promise<ShortcutsConfig> {
    const shortcuts = await getSettingsSection("shortcuts");
    return {
      pushToTalk: shortcuts?.pushToTalk ?? [],
      toggleRecording: shortcuts?.toggleRecording ?? [],
    };
  }

  /**
   * Update shortcuts configuration
   */
  async setShortcuts(shortcuts: ShortcutsConfig): Promise<void> {
    // Store empty arrays as undefined to clear shortcuts
    const dataToStore = {
      pushToTalk: shortcuts.pushToTalk?.length
        ? shortcuts.pushToTalk
        : undefined,
      toggleRecording: shortcuts.toggleRecording?.length
        ? shortcuts.toggleRecording
        : undefined,
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
   * Get OpenAI configuration
   */
  async getOpenAIConfig(): Promise<{ apiKey: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.openAI;
  }

  /**
   * Update OpenAI configuration
   */
  async setOpenAIConfig(config: { apiKey: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      openAI: config,
    });
  }

  /**
   * Get Groq configuration
   */
  async getGroqConfig(): Promise<{ apiKey: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.groq;
  }

  /**
   * Update Groq configuration
   */
  async setGroqConfig(config: { apiKey: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      groq: config,
    });
  }

  /**
   * Get Grok configuration
   */
  async getGrokConfig(): Promise<{ apiKey: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.grok;
  }

  /**
   * Update Grok configuration
   */
  async setGrokConfig(config: { apiKey: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      grok: config,
    });
  }

  /**
   * Get Anthropic configuration
   */
  async getAnthropicConfig(): Promise<{ apiKey: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.anthropic;
  }

  /**
   * Update Anthropic configuration
   */
  async setAnthropicConfig(config: { apiKey: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      anthropic: config,
    });
  }

  /**
   * Get Google configuration
   */
  async getGoogleConfig(): Promise<{ apiKey: string } | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.google;
  }

  /**
   * Update Google configuration
   */
  async setGoogleConfig(config: { apiKey: string }): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      google: config,
    });
  }

  /**
   * Get selected speech model (Whisper)
   */
  async getDefaultSpeechModel(): Promise<string | undefined> {
    const config = await this.getModelProvidersConfig();
    return config?.defaultSpeechModel;
  }

  /**
   * Set selected speech model (Whisper)
   */
  async setDefaultSpeechModel(modelId: string | undefined): Promise<void> {
    const currentConfig = await this.getModelProvidersConfig();
    await this.setModelProvidersConfig({
      ...currentConfig,
      defaultSpeechModel: modelId,
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
      showInDock: preferences?.showInDock ?? true,
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

    // Emit event for listeners (AppManager will handle window updates)
    this.emit("preferences-changed", {
      changes: preferences,
      showWidgetWhileInactiveChanged:
        preferences.showWidgetWhileInactive !== undefined,
      showInDockChanged: preferences.showInDock !== undefined,
    });
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
   * Sync the dock visibility setting with macOS
   * This ensures the dock visibility matches our stored preference
   */
  syncDockVisibility(): void {
    // Only applicable on macOS where app.dock exists
    if (!app.dock) {
      return;
    }

    // Get the current preference asynchronously and apply it
    this.getPreferences().then((preferences) => {
      if (preferences.showInDock) {
        app.dock?.show();
      } else {
        app.dock?.hide();
      }
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

  // --- Modes CRUD ---

  private static readonly MAX_MODES = 20;

  private buildFallbackMode(settings: AppSettingsData): ModeConfig {
    const now = new Date().toISOString();
    return {
      id: "default",
      name: "Default",
      isDefault: true,
      dictation: settings.dictation ?? {
        autoDetectEnabled: true,
        selectedLanguage: "en",
      },
      formatterConfig: settings.formatterConfig ?? { enabled: false },
      customInstructions: undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getModes(): Promise<{ items: ModeConfig[]; activeModeId: string }> {
    const settings = await getAppSettings();
    if (settings.modes && settings.modes.items.length > 0) {
      return settings.modes;
    }
    // Fallback: construct from legacy settings
    const fallback = this.buildFallbackMode(settings);
    return { items: [fallback], activeModeId: "default" };
  }

  async getActiveMode(): Promise<ModeConfig> {
    const { items, activeModeId } = await this.getModes();
    const active = items.find((m) => m.id === activeModeId);
    if (active) return active;
    // Fallback to first item (should always exist)
    return items[0];
  }

  async setActiveMode(modeId: string): Promise<void> {
    const { items } = await this.getModes();
    if (!items.find((m) => m.id === modeId)) {
      throw new Error(`Mode with id "${modeId}" not found`);
    }
    const settings = await getAppSettings();
    await updateAppSettings({
      modes: { ...settings.modes!, activeModeId: modeId },
    });
    this.emit("active-mode-changed", { modeId });
  }

  async createMode(
    input: Omit<ModeConfig, "id" | "isDefault" | "createdAt" | "updatedAt">,
  ): Promise<ModeConfig> {
    const { items, activeModeId } = await this.getModes();
    if (items.length >= SettingsService.MAX_MODES) {
      throw new Error(
        `Maximum number of modes (${SettingsService.MAX_MODES}) reached`,
      );
    }
    const now = new Date().toISOString();
    const newMode: ModeConfig = {
      ...input,
      id: crypto.randomUUID(),
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    await updateAppSettings({
      modes: { items: [...items, newMode], activeModeId },
    });
    return newMode;
  }

  async updateMode(
    modeId: string,
    updates: Partial<
      Pick<ModeConfig, "name" | "dictation" | "formatterConfig" | "customInstructions" | "speechModelId" | "appBindings">
    >,
  ): Promise<ModeConfig> {
    const { items, activeModeId } = await this.getModes();
    const index = items.findIndex((m) => m.id === modeId);
    if (index === -1) {
      throw new Error(`Mode with id "${modeId}" not found`);
    }
    const updated: ModeConfig = {
      ...items[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const newItems = [...items];
    newItems[index] = updated;
    await updateAppSettings({
      modes: { items: newItems, activeModeId },
    });
    return updated;
  }

  async deleteMode(modeId: string): Promise<void> {
    const { items, activeModeId } = await this.getModes();
    const mode = items.find((m) => m.id === modeId);
    if (!mode) {
      throw new Error(`Mode with id "${modeId}" not found`);
    }
    if (mode.isDefault) {
      throw new Error("Cannot delete the default mode");
    }
    if (items.length <= 1) {
      throw new Error("Cannot delete the last remaining mode");
    }
    const newItems = items.filter((m) => m.id !== modeId);
    const newActiveModeId =
      activeModeId === modeId ? "default" : activeModeId;
    await updateAppSettings({
      modes: { items: newItems, activeModeId: newActiveModeId },
    });
    if (activeModeId === modeId) {
      this.emit("active-mode-changed", { modeId: newActiveModeId });
    }
  }

  async findModeByBundleId(bundleId: string): Promise<ModeConfig | null> {
    const { items } = await this.getModes();
    for (const mode of items) {
      if (mode.appBindings?.includes(bundleId)) {
        return mode;
      }
    }
    return null;
  }
}
