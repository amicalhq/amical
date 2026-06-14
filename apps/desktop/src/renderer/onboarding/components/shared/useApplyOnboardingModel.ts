import { useEffect } from "react";
import { api } from "@/trpc/react";

/**
 * Selects the chosen speech model the moment its prerequisite is met — cloud
 * sign-in or local download — so the try-it segment has a usable model instead
 * of firing "no model selected". Fires once on the false→true edge of `ready`;
 * idempotent server-side, and onboarding completion re-applies as a safety net.
 */
export function useApplyOnboardingModel(ready: boolean): void {
  const { mutate: applySelectedModel } =
    api.onboarding.applySelectedModel.useMutation();
  useEffect(() => {
    if (ready) applySelectedModel();
  }, [ready, applySelectedModel]);
}
