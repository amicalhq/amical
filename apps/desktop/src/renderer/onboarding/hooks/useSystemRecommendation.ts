import { useEffect, useState } from "react";
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
  const [recommendation, setRecommendation] =
    useState<ModelRecommendation | null>(null);

  const query = api.onboarding.getSystemRecommendation.useQuery();

  useEffect(() => {
    if (query.data) {
      setRecommendation(query.data);
    }
  }, [query.data]);

  return {
    recommendation,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
