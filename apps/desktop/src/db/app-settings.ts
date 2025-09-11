/**
 * Application Settings Management
 *
 * This module manages app settings with a section-based approach:
 * - Settings are organized into top-level sections (ui, transcription, recording, etc.)
 * - Each section is treated as an atomic unit - updates replace the entire section
 * - No deep merging is performed within sections to avoid complexity
 *
 * When updating settings:
 * - To update a single field, fetch the current section, modify it, and save the complete section
 * - The SettingsService handles this pattern correctly for all methods
 * - Direct calls to updateAppSettings should pass complete sections
 */

import { eq } from "drizzle-orm";
import { db } from ".";
import {
  appSettings,
  type NewAppSettings,
  type AppSettingsData,
} from "./schema";
import { isWindows, isMacOS } from "../utils/platform";

// Singleton ID for app settings (we only have one settings record)
const SETTINGS_ID = 1;

// Platform-specific default shortcuts
const getDefaultShortcuts = () => {
  if (isMacOS()) {
    return {
      pushToTalk: "Fn",
      toggleRecording: "Fn+Space",
    };
  } else {
    // Windows and Linux
    return {
      pushToTalk: "Ctrl+Win",
      toggleRecording: "Ctrl+Win+Space",
    };
  }
};

// Default settings
const defaultSettings: AppSettingsData = {
  formatterConfig: {
    model: "", // Will be set when models are synced
    enabled: false,
  },
  ui: {
    theme: "system",
    sidebarOpen: false,
    currentView: "Voice Recording",
  },
  transcription: {
    language: "en",
    autoTranscribe: true,
    confidenceThreshold: 0.8,
    enablePunctuation: true,
    enableTimestamps: false,
  },
  recording: {
    defaultFormat: "wav",
    sampleRate: 16000,
    autoStopSilence: true,
    silenceThreshold: 3,
    maxRecordingDuration: 60,
  },
  shortcuts: getDefaultShortcuts(),
  modelProvidersConfig: {
    defaultSpeechModel: "",
    defaultLanguageModel: "",
    defaultEmbeddingModel: "",
  },
};

// Get all app settings
export async function getAppSettings(): Promise<AppSettingsData> {
  const result = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID));

  if (result.length === 0) {
    // Create default settings if none exist
    await createDefaultSettings();
    return defaultSettings;
  }

  return result[0].data;
}

// Update app settings (shallow merge at top level only)
// IMPORTANT: When updating a section, always pass the complete section.
// This function does NOT deep merge nested objects.
export async function updateAppSettings(
  newSettings: Partial<AppSettingsData>,
): Promise<AppSettingsData> {
  const currentSettings = await getAppSettings();

  // Simple shallow merge - each top-level section is replaced entirely
  const mergedSettings: AppSettingsData = {
    ...currentSettings,
    ...newSettings,
  };

  const now = new Date();

  await db
    .update(appSettings)
    .set({
      data: mergedSettings,
      updatedAt: now,
    })
    .where(eq(appSettings.id, SETTINGS_ID));

  return mergedSettings;
}

// Replace all app settings (complete override)
export async function replaceAppSettings(
  newSettings: AppSettingsData,
): Promise<AppSettingsData> {
  const now = new Date();

  await db
    .update(appSettings)
    .set({
      data: newSettings,
      updatedAt: now,
    })
    .where(eq(appSettings.id, SETTINGS_ID));

  return newSettings;
}

// Get a specific setting section
export async function getSettingsSection<K extends keyof AppSettingsData>(
  section: K,
): Promise<AppSettingsData[K]> {
  const settings = await getAppSettings();
  return settings[section];
}

//! Update a specific setting section (replaces the entire section)
//! IMPORTANT: This replaces the entire section with newData.
//! Make sure to pass the complete section data, not partial updates.
export async function updateSettingsSection<K extends keyof AppSettingsData>(
  section: K,
  newData: AppSettingsData[K],
): Promise<AppSettingsData> {
  return await updateAppSettings({
    [section]: newData,
  } as Partial<AppSettingsData>);
}

// Reset settings to defaults
export async function resetAppSettings(): Promise<AppSettingsData> {
  return await replaceAppSettings(defaultSettings);
}

// Create default settings (internal helper)
async function createDefaultSettings(): Promise<void> {
  const now = new Date();

  const newSettings: NewAppSettings = {
    id: SETTINGS_ID,
    data: defaultSettings,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(appSettings).values(newSettings);
}

// Export default settings for reference
export { defaultSettings };
