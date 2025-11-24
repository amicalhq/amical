import { useState, useEffect, useCallback } from "react";
import { api } from "@/trpc/react";
import type {
  OnboardingState,
  OnboardingPreferences,
  OnboardingScreen,
  FeatureInterest,
  DiscoverySource,
  ModelType,
} from "../../../types/onboarding";
import { toast } from "sonner";

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
  const [state, setState] = useState<OnboardingState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // tRPC queries and mutations
  const getStateQuery = api.onboarding.getState.useQuery();
  const savePreferencesMutation = api.onboarding.savePreferences.useMutation();
  const completeMutation = api.onboarding.complete.useMutation();
  const trackOnboardingCompleted =
    api.onboarding.trackOnboardingCompleted.useMutation();
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
          getStateQuery.error.message || "Failed to load onboarding state",
        ),
      );
      setIsLoading(false);
    }
  }, [getStateQuery.data, getStateQuery.error]);

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
        toast.error("Failed to save your preferences. Please try again.");
        throw err;
      }
    },
    [savePreferencesMutation],
  );

  // Complete onboarding
  const completeOnboarding = useCallback(
    async (finalState: OnboardingState) => {
      try {
        const result = await completeMutation.mutateAsync(finalState);

        if (!result.success) {
          throw new Error("Failed to complete onboarding");
        }

        // Track completion event
        trackOnboardingCompleted.mutate({
          version: finalState.completedVersion,
          features_selected: finalState.featureInterests || [],
          discovery_source: finalState.discoverySource,
          model_type: finalState.selectedModelType,
          recommendation_followed:
            finalState.modelRecommendation?.followed || false,
          skipped_screens: finalState.skippedScreens,
        });

        // Handle relaunch if needed
        if (result.shouldRelaunch) {
          toast.success("Onboarding complete! Restarting application...");
          // The app will relaunch automatically from the main process
        } else {
          toast.success("Onboarding complete!");
          // In development, just reload
          window.location.reload();
        }
      } catch (err) {
        console.error("Failed to complete onboarding:", err);
        toast.error("Failed to complete onboarding. Please try again.");
        throw err;
      }
    },
    [completeMutation, trackOnboardingCompleted],
  );

  // Reset onboarding (for testing)
  const resetOnboarding = useCallback(async () => {
    try {
      await resetMutation.mutateAsync();
      setState(null);
      toast.success("Onboarding reset successfully");
      await getStateQuery.refetch();
    } catch (err) {
      console.error("Failed to reset onboarding:", err);
      toast.error("Failed to reset onboarding");
      throw err;
    }
  }, [resetMutation, getStateQuery]);

  return {
    state,
    isLoading,
    error,
    savePreferences,
    completeOnboarding,
    resetOnboarding,
  };
}
