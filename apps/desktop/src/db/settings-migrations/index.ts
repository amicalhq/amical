import type { AppSettingsData } from "../schema";
import { migrateToV2 } from "./v2";
import { migrateToV3 } from "./v3";
import { migrateToV4 } from "./v4";
import { migrateToV5 } from "./v5";
import { migrateToV6 } from "./v6";
import { migrateToV7 } from "./v7";
import { migrateToV8 } from "./v8";

export type MigrationFn = (data: unknown) => AppSettingsData;

// Current settings schema version - increment when making breaking changes
export const CURRENT_SETTINGS_VERSION = 8;

const migrations: Record<number, MigrationFn> = {
  2: migrateToV2,
  3: migrateToV3,
  4: migrateToV4,
  5: migrateToV5,
  6: migrateToV6,
  7: migrateToV7,
  8: migrateToV8,
};

/**
 * Run migrations from current version to target version
 */
export function migrateSettings(
  data: unknown,
  fromVersion: number,
): AppSettingsData {
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
