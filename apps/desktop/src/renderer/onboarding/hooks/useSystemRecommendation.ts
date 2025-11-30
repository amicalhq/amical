import { api } from "@/trpc/react";
import type { ModelRecommendation } from "../../../types/onboarding";

interface UseSystemRecommendationReturn {
  recommendation: ModelRecommendation | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to get system recommendation for model selection
 * Analyzes system specs and provides intelligent recommendations
 */
export function useSystemRecommendation(): UseSystemRecommendationReturn {
  const query = api.onboarding.getSystemRecommendation.useQuery();

  return {
    recommendation: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
