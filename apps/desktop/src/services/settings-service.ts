import { FormatterConfig } from "../types/formatter";
import {
  getSettingsSection,
  updateSettingsSection,
  getAppSettings,
  updateAppSettings,
} from "../db/app-settings";
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
}
