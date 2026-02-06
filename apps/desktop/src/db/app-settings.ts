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
 *
 * Settings Versioning:
 * - Settings have a version number for migrations
 * - When schema changes, increment CURRENT_SETTINGS_VERSION and add a migration function
 * - Migrations run automatically when loading settings with an older version
 */

import { eq } from "drizzle-orm";
import { db } from ".";
import {
  appSettings,
  type NewAppSettings,
  type AppSettingsData,
  type ModeConfig,
} from "./schema";
import { isMacOS } from "../utils/platform";

// Current settings schema version - increment when making breaking changes
const CURRENT_SETTINGS_VERSION = 4;

// Type for v1 settings (before shortcuts array migration)
interface AppSettingsDataV1 extends Omit<AppSettingsData, "shortcuts"> {
  shortcuts?: {
    pushToTalk?: string;
    toggleRecording?: string;
    toggleWindow?: string;
  };
}

// Migration function type
type MigrationFn = (data: unknown) => AppSettingsData;

// Migration functions - keyed by target version
const migrations: Record<number, MigrationFn> = {
  // v1 -> v2: Convert shortcuts from string ("Fn+Space") to array (["Fn", "Space"])
  2: (data: unknown): AppSettingsData => {
    const oldData = data as AppSettingsDataV1;
    const oldShortcuts = oldData.shortcuts;

    // Convert string shortcuts to arrays
    const convertShortcut = (
      shortcut: string | undefined,
    ): string[] | undefined => {
      if (!shortcut || shortcut === "") {
        return undefined;
      }
      return shortcut.split("+");
    };

    return {
      ...oldData,
      shortcuts: oldShortcuts
        ? {
            pushToTalk: convertShortcut(oldShortcuts.pushToTalk),
            toggleRecording: convertShortcut(oldShortcuts.toggleRecording),
          }
        : undefined,
    } as AppSettingsData;
  },

  // v2 -> v3: Reserved migration (no-op)
  3: (data: unknown): AppSettingsData => data as AppSettingsData,
  // v3 -> v4: Reserved migration (no-op)
  4: (data: unknown): AppSettingsData => data as AppSettingsData,
};

/**
 * Run migrations from current version to target version
 */
function migrateSettings(data: unknown, fromVersion: number): AppSettingsData {
  let currentData = data;

  for (let v = fromVersion + 1; v <= CURRENT_SETTINGS_VERSION; v++) {
    const migrationFn = migrations[v];
    if (migrationFn) {
      currentData = migrationFn(currentData);
      console.log(`[Settings] Migrated settings from v${v - 1} to v${v}`);
    }
  }

  return currentData as AppSettingsData;
}

// --- Vox custom migrations (independent from upstream `version` column) ---
const CURRENT_VOX_VERSION = 1;

const voxMigrations: Record<number, MigrationFn> = {
  // vox v0 → v1: Create "Default" mode from existing dictation + formatterConfig
  1: (data: unknown): AppSettingsData => {
    const oldData = data as AppSettingsData;
    const now = new Date().toISOString();
    const defaultMode: ModeConfig = {
      id: "default",
      name: "Default",
      isDefault: true,
      dictation: oldData.dictation ?? {
        autoDetectEnabled: true,
        selectedLanguage: "en",
      },
      formatterConfig: oldData.formatterConfig ?? { enabled: false },
      customInstructions: undefined,
      createdAt: now,
      updatedAt: now,
    };
    return {
      ...oldData,
      modes: { items: [defaultMode], activeModeId: "default" },
      _voxVersion: 1,
    };
  },
};

function migrateVoxSettings(
  data: AppSettingsData,
  fromVersion: number,
): AppSettingsData {
  let currentData: unknown = data;

  for (let v = fromVersion + 1; v <= CURRENT_VOX_VERSION; v++) {
    const migrationFn = voxMigrations[v];
    if (migrationFn) {
      currentData = migrationFn(currentData);
      console.log(`[Settings] Vox migration: v${v - 1} → v${v}`);
    }
  }

  return currentData as AppSettingsData;
}

// Singleton ID for app settings (we only have one settings record)
const SETTINGS_ID = 1;

// Platform-specific default shortcuts (array format)
const getDefaultShortcuts = () => {
  if (isMacOS()) {
    return {
      pushToTalk: ["Fn"],
      toggleRecording: ["Fn", "Space"],
    };
  } else {
    // Windows and Linux
    return {
      pushToTalk: ["Ctrl", "Win"],
      toggleRecording: ["Ctrl", "Win", "Space"],
    };
  }
};

// Default settings
const defaultSettings: AppSettingsData = {
  formatterConfig: {
    enabled: false,
  },
  ui: {
    theme: "system",
  },
  preferences: {
    launchAtLogin: true,
    showWidgetWhileInactive: true,
    showInDock: true,
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
  },
  modes: {
    items: [
      {
        id: "default",
        name: "Default",
        isDefault: true,
        dictation: { autoDetectEnabled: true, selectedLanguage: "en" },
        formatterConfig: { enabled: false },
        customInstructions: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    activeModeId: "default",
  },
  _voxVersion: CURRENT_VOX_VERSION,
};

// Get all app settings (with automatic migration if needed)
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

  const record = result[0];

  // Check if migration is needed
  if (record.version < CURRENT_SETTINGS_VERSION) {
    const migratedData = migrateSettings(record.data, record.version);

    // Save migrated data with new version
    const now = new Date();
    await db
      .update(appSettings)
      .set({
        data: migratedData,
        version: CURRENT_SETTINGS_VERSION,
        updatedAt: now,
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    console.log(
      `[Settings] Migration complete: v${record.version} -> v${CURRENT_SETTINGS_VERSION}`,
    );
    return migratedData;
  }

  // Run Vox custom migrations (independent from upstream version)
  let settingsData = record.data;
  const voxVersion = settingsData._voxVersion ?? 0;
  if (voxVersion < CURRENT_VOX_VERSION) {
    settingsData = migrateVoxSettings(settingsData, voxVersion);

    const now = new Date();
    await db
      .update(appSettings)
      .set({
        data: settingsData,
        updatedAt: now,
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    console.log(
      `[Settings] Vox migration complete: v${voxVersion} -> v${CURRENT_VOX_VERSION}`,
    );
  }

  return settingsData;
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
    version: CURRENT_SETTINGS_VERSION,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(appSettings).values(newSettings);
}

// Export default settings for reference
export { defaultSettings };
