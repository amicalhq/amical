import { DEFAULT_HISTORY_RETENTION_PERIOD } from "../../constants/history-retention";
import type { AppSettingsData } from "../schema";

// v10 -> v11: add history retention settings
export function migrateToV11(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  const history: Partial<NonNullable<AppSettingsData["history"]>> =
    oldData.history ?? {};

  return {
    ...oldData,
    history: {
      ...history,
      retentionPeriod:
        history.retentionPeriod ?? DEFAULT_HISTORY_RETENTION_PERIOD,
    },
  };
}
