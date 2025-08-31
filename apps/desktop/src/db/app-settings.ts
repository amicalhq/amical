import { eq } from "drizzle-orm";
import { db } from "./config";
import {
  appSettings,
  type NewAppSettings,
  type AppSettingsData,
} from "./schema";

// Singleton ID for app settings (we only have one settings record)
const SETTINGS_ID = 1;

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
  shortcuts: {
    pushToTalk: "Fn",
    toggleRecording: "",
  },
  modelProvidersConfig: {
    openRouter: {
      apiKey: "",
    },
    // Don't include ollama config by default - let it be undefined so it shows as disconnected
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

// Update app settings (merges with existing settings)
export async function updateAppSettings(
  newSettings: Partial<AppSettingsData>
): Promise<AppSettingsData> {
  const currentSettings = await getAppSettings();
  const mergedSettings: AppSettingsData = {
    ...currentSettings,
    ...newSettings,
  };

  // Deep merge specific nested objects if they exist in newSettings
  if (newSettings.formatterConfig && currentSettings.formatterConfig) {
    mergedSettings.formatterConfig = {
      ...currentSettings.formatterConfig,
      ...newSettings.formatterConfig,
    };
  }

  if (newSettings.ui && currentSettings.ui) {
    mergedSettings.ui = {
      ...currentSettings.ui,
      ...newSettings.ui,
    };
  }

  if (newSettings.transcription && currentSettings.transcription) {
    mergedSettings.transcription = {
      ...currentSettings.transcription,
      ...newSettings.transcription,
    };
  }

  if (newSettings.recording && currentSettings.recording) {
    mergedSettings.recording = {
      ...currentSettings.recording,
      ...newSettings.recording,
    };
  }

  if (newSettings.shortcuts && currentSettings.shortcuts) {
    mergedSettings.shortcuts = {
      ...currentSettings.shortcuts,
      ...newSettings.shortcuts,
    };
  }

  if (
    newSettings.modelProvidersConfig &&
    currentSettings.modelProvidersConfig
  ) {
    mergedSettings.modelProvidersConfig = {
      ...currentSettings.modelProvidersConfig,
      ...newSettings.modelProvidersConfig,
    };

    // Deep merge nested provider configs
    if (
      newSettings.modelProvidersConfig.openRouter &&
      currentSettings.modelProvidersConfig.openRouter
    ) {
      mergedSettings.modelProvidersConfig.openRouter = {
        ...currentSettings.modelProvidersConfig.openRouter,
        ...newSettings.modelProvidersConfig.openRouter,
      };
    }

    if (
      newSettings.modelProvidersConfig.ollama &&
      currentSettings.modelProvidersConfig.ollama
    ) {
      mergedSettings.modelProvidersConfig.ollama = {
        ...currentSettings.modelProvidersConfig.ollama,
        ...newSettings.modelProvidersConfig.ollama,
      };
    }
  }

  const now = new Date();

  await db
    .update(appSettings)
    .set({
      data: mergedSettings,
      updatedAt: now,
    })
    .where(eq(appSettings.id, SETTINGS_ID));

  console.log("mergedSettings", mergedSettings);

  return mergedSettings;
}

// Replace all app settings (complete override)
export async function replaceAppSettings(
  newSettings: AppSettingsData
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
  section: K
): Promise<AppSettingsData[K]> {
  const settings = await getAppSettings();
  return settings[section];
}

// Update a specific setting section
export async function updateSettingsSection<K extends keyof AppSettingsData>(
  section: K,
  newData: AppSettingsData[K]
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
