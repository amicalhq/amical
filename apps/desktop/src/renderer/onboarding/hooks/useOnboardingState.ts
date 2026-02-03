import { useState, useEffect, useCallback } from "react";
import { api } from "@/trpc/react";
import type {
  OnboardingState,
  OnboardingPreferences,
} from "../../../types/onboarding";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface UseOnboardingStateReturn {
  state: OnboardingState | null;
  isLoading: boolean;
  error: Error | null;
  savePreferences: (preferences: OnboardingPreferences) => Promise<void>;
  completeOnboarding: (finalState: OnboardingState) => Promise<void>;
  resetOnboarding: () => Promise<void>;
}

/**
 * Hook to manage onboarding state and persistence
 */
export function useOnboardingState(): UseOnboardingStateReturn {
  const { t } = useTranslation();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // tRPC queries and mutations
  const getStateQuery = api.onboarding.getState.useQuery();
  const savePreferencesMutation = api.onboarding.savePreferences.useMutation();
  const completeMutation = api.onboarding.complete.useMutation();
  const resetMutation = api.onboarding.reset.useMutation();

  // Load initial state
  useEffect(() => {
    if (getStateQuery.data !== undefined) {
      setState(getStateQuery.data);
      setIsLoading(false);
    }
    if (getStateQuery.error) {
      setError(
        new Error(
          getStateQuery.error.message || t("onboarding.toast.loadStateFailed"),
        ),
      );
      setIsLoading(false);
    }
  }, [getStateQuery.data, getStateQuery.error, t]);

  // Save preferences (called after each screen)
  const savePreferences = useCallback(
    async (preferences: OnboardingPreferences) => {
      try {
        const result = await savePreferencesMutation.mutateAsync(preferences);

        if (!result.success) {
          throw new Error(result.message || "Failed to save preferences");
        }

        // Update local state optimistically
        setState((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };

          if (preferences.featureInterests !== undefined) {
            updated.featureInterests = preferences.featureInterests;
          }
          if (preferences.discoverySource !== undefined) {
            updated.discoverySource = preferences.discoverySource;
          }
          if (preferences.selectedModelType !== undefined) {
            updated.selectedModelType = preferences.selectedModelType;
          }
          if (preferences.modelRecommendation !== undefined) {
            updated.modelRecommendation = preferences.modelRecommendation;
          }

          return updated;
        });
      } catch (err) {
        console.error("Failed to save preferences:", err);
        toast.error(t("onboarding.toast.savePreferencesFailed"));
        throw err;
      }
    },
    [savePreferencesMutation, t],
  );

  // Complete onboarding
  const completeOnboarding = useCallback(
    async (finalState: OnboardingState) => {
      try {
        const result = await completeMutation.mutateAsync(finalState);

        if (!result.success) {
          throw new Error("Failed to complete onboarding");
        }

        // Main process handles window closing and app relaunch
        toast.success(t("onboarding.toast.completed"));
      } catch (err) {
        console.error("Failed to complete onboarding:", err);
        toast.error(t("onboarding.toast.completeFailed"));
        throw err;
      }
    },
    [completeMutation, t],
  );

  // Reset onboarding (for testing)
  const resetOnboarding = useCallback(async () => {
    try {
      await resetMutation.mutateAsync();
      setState(null);
      toast.success(t("onboarding.toast.resetSuccess"));
      await getStateQuery.refetch();
    } catch (err) {
      console.error("Failed to reset onboarding:", err);
      toast.error(t("onboarding.toast.resetFailed"));
      throw err;
    }
  }, [resetMutation, getStateQuery, t]);

  return {
    state,
    isLoading,
    error,
    savePreferences,
    completeOnboarding,
    resetOnboarding,
  };
}
