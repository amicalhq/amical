import type { AppSettingsData } from "../schema";

// v15 -> v16: telemetry is now off until the user opts in or signs in. Before
// v16 a missing value meant on, so installs that finished onboarding (or are
// signed in) keep it on. Installs still in onboarding get the new default and
// choose during onboarding.
export function migrateToV16(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  if (oldData.telemetry?.enabled !== undefined) {
    return oldData;
  }
  if (!oldData.onboarding?.completedVersion && !oldData.auth?.isAuthenticated) {
    return oldData;
  }
  return { ...oldData, telemetry: { enabled: true } };
}
