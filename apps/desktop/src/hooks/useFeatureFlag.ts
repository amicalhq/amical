import { api } from "@/trpc/react";
import { isFeatureFlagEnabled } from "@/utils/feature-flags";

type UseFeatureFlagResult = {
  enabled: boolean;
  value: string | boolean | undefined;
  payload: unknown;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
};

export function useFeatureFlag(key: string): UseFeatureFlagResult {
  const query = api.featureFlags.getFlag.useQuery({ key });
  const value = query.data?.value;

  return {
    enabled: isFeatureFlagEnabled(value),
    value,
    payload: query.data?.payload,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
