export const HISTORY_RETENTION_PERIODS = [
  "1d",
  "7d",
  "14d",
  "28d",
  "never",
] as const;

export type HistoryRetentionPeriod = (typeof HISTORY_RETENTION_PERIODS)[number];

export const DEFAULT_HISTORY_RETENTION_PERIOD: HistoryRetentionPeriod = "never";

const HISTORY_RETENTION_DAYS: Record<
  Exclude<HistoryRetentionPeriod, "never">,
  number
> = {
  "1d": 1,
  "7d": 7,
  "14d": 14,
  "28d": 28,
};

export function getHistoryRetentionCutoffDate(
  retentionPeriod: HistoryRetentionPeriod,
  now = new Date(),
): Date | null {
  if (retentionPeriod === "never") {
    return null;
  }

  const retentionDays = HISTORY_RETENTION_DAYS[retentionPeriod];
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
