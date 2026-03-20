import type { FeatureFlagService } from "@/services/feature-flag-service";
import { isFeatureFlagEnabled } from "@/utils/feature-flags";

export type MainFeatureFlagState = {
  enabled: boolean;
  value: string | boolean | undefined;
  payload: unknown;
};

export async function getMainFeatureFlagState(
  featureFlagService: FeatureFlagService,
  key: string,
): Promise<MainFeatureFlagState> {
  const { value, payload } = await featureFlagService.getFlagWithPayload(key);

  return {
    enabled: isFeatureFlagEnabled(value),
    value,
    payload,
  };
}
