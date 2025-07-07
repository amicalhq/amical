import type { OnboardingAPI } from "@/types/onboarding-api";

declare global {
  interface Window {
    onboardingAPI: OnboardingAPI;
  }
}
