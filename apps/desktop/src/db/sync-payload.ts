import { z } from "zod";
import { SettingsSyncKeySchema } from "@amical/types";

export {
  SETTINGS_SYNC_KEY_MAX_LENGTH as SYNC_KEY_MAX_LENGTH,
  SETTINGS_SYNC_TEXT_MAX_LENGTH as SYNC_TEXT_MAX_LENGTH,
  SettingsSyncKeySchema as axisSyncKeySchema,
  SettingsSyncOptionalTextSchema as axisSyncOptionalTextSchema,
  SettingsSyncRequiredTextSchema as axisSyncRequiredTextSchema,
} from "@amical/types";

export const trimmedSyncKeySchema = z
  .string()
  .trim()
  .pipe(SettingsSyncKeySchema);
