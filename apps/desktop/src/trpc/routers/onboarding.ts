import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import { ServiceManager } from "../../main/managers/service-manager";
import {
  OnboardingPreferencesSchema,
  OnboardingStateSchema,
  AnalyticsEventSchema,
  ModelTypeSchema,
  FeatureInterestSchema,
  DiscoverySourceSchema,
  OnboardingScreenSchema,
  type OnboardingState,
  type ModelRecommendation,
  type OnboardingFeatureFlags,
  type OnboardingPreferences,
} from "../../types/onboarding";
import { logger } from "../../main/logger";

export const onboardingRouter = createRouter({
  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /**
   * Get current onboarding state from database
   */
  getState: procedure.query(async () => {
    try {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        logger.main.warn("ServiceManager not available");
        return null;
      }
      const onboardingService = serviceManager.getOnboardingService();

      if (!onboardingService) {
        logger.main.warn("OnboardingService not available");
        return null;
      }

      const state = await onboardingService.getOnboardingState();
      return state;
    } catch (error) {
      logger.main.error("Failed to get onboarding state:", error);
      throw error;
    }
  }),

  /**
   * Get system recommendation for model selection
   */
  getSystemRecommendation: procedure.query(
    async (): Promise<ModelRecommendation> => {
      try {
        const serviceManager = ServiceManager.getInstance();
        if (!serviceManager) {
          throw new Error("ServiceManager not available");
        }
        const onboardingService = serviceManager.getOnboardingService();

        if (!onboardingService) {
          throw new Error("OnboardingService not available");
        }

        const recommendation =
          await onboardingService.getSystemRecommendation();
        return recommendation;
      } catch (error) {
        logger.main.error("Failed to get system recommendation:", error);
        throw error;
      }
    },
  ),

  /**
   * Check if onboarding is needed
   */
  needsOnboarding: procedure.query(async () => {
    try {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        // If service manager not available, assume onboarding not needed
        return {
          needed: false,
          reason: {
            forceOnboarding: false,
            notCompleted: false,
            missingPermissions: false,
          },
        };
      }
      const onboardingService = serviceManager.getOnboardingService();

      if (!onboardingService) {
        // If service not available, assume onboarding not needed
        return {
          needed: false,
          reason: {
            forceOnboarding: false,
            notCompleted: false,
            missingPermissions: false,
          },
        };
      }

      const result = await onboardingService.checkNeedsOnboarding();
      return result;
    } catch (error) {
      logger.main.error("Failed to check onboarding needs:", error);
      // On error, assume onboarding not needed
      return {
        needed: false,
        reason: {
          forceOnboarding: false,
          notCompleted: false,
          missingPermissions: false,
        },
      };
    }
  }),

  /**
   * Get feature flags for screen visibility
   */
  getFeatureFlags: procedure.query(
    async (): Promise<OnboardingFeatureFlags> => {
      try {
        const serviceManager = ServiceManager.getInstance();
        if (!serviceManager) {
          // Return all screens enabled by default
          return {
            skipWelcome: false,
            skipFeatures: false,
            skipDiscovery: false,
            skipModels: false,
          };
        }
        const onboardingService = serviceManager.getOnboardingService();

        if (!onboardingService) {
          // Return all screens enabled by default
          return {
            skipWelcome: false,
            skipFeatures: false,
            skipDiscovery: false,
            skipModels: false,
          };
        }

        const flags = onboardingService.getFeatureFlags();
        return flags;
      } catch (error) {
        logger.main.error("Failed to get feature flags:", error);
        // Return all screens enabled on error
        return {
          skipWelcome: false,
          skipFeatures: false,
          skipDiscovery: false,
          skipModels: false,
        };
      }
    },
  ),

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  /**
   * Save onboarding preferences (called after each screen)
   */
  savePreferences: procedure
    .input(OnboardingPreferencesSchema)
    .mutation(
      async ({ input }): Promise<{ success: boolean; message?: string }> => {
        try {
          const serviceManager = ServiceManager.getInstance();
          if (!serviceManager) {
            throw new Error("ServiceManager not available");
          }
          const onboardingService = serviceManager.getOnboardingService();

          if (!onboardingService) {
            throw new Error("OnboardingService not available");
          }

          await onboardingService.savePreferences(input);
          logger.main.debug("Saved onboarding preferences:", input);

          return { success: true };
        } catch (error) {
          logger.main.error("Failed to save onboarding preferences:", error);
          return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    ),

  /**
   * Track analytics event
   */
  trackEvent: procedure
    .input(AnalyticsEventSchema)
    .mutation(
      async ({ input }): Promise<{ tracked: boolean; reason?: string }> => {
        try {
          const serviceManager = ServiceManager.getInstance();
          if (!serviceManager) {
            return { tracked: false, reason: "ServiceManager not available" };
          }
          const onboardingService = serviceManager.getOnboardingService();
          const settingsService = serviceManager.getSettingsService();

          if (!onboardingService || !settingsService) {
            return { tracked: false, reason: "Services not available" };
          }

          // Check if telemetry is enabled
          const telemetrySettings =
            await settingsService.getTelemetrySettings();
          if (telemetrySettings?.enabled === false) {
            return { tracked: false, reason: "telemetry_disabled" };
          }

          // Track the event
          onboardingService.trackEvent(input.eventName, input.properties);
          logger.main.debug("Tracked onboarding event:", input);

          return { tracked: true };
        } catch (error) {
          logger.main.error("Failed to track onboarding event:", error);
          return { tracked: false, reason: "error" };
        }
      },
    ),

  /**
   * Complete onboarding and save final state
   */
  complete: procedure
    .input(OnboardingStateSchema)
    .mutation(
      async ({
        input,
      }): Promise<{ success: boolean; shouldRelaunch: boolean }> => {
        try {
          const serviceManager = ServiceManager.getInstance();
          if (!serviceManager) {
            throw new Error("ServiceManager not available");
          }
          const onboardingService = serviceManager.getOnboardingService();
          const onboardingManager = serviceManager.getOnboardingManager();

          if (!onboardingService || !onboardingManager) {
            throw new Error("Onboarding services not available");
          }

          // Complete onboarding through the manager (handles window closing and relaunching)
          await onboardingManager.completeOnboarding(input);

          // Determine if app needs to relaunch
          const isDevelopment = process.env.NODE_ENV === "development";
          const shouldRelaunch = !isDevelopment;

          logger.main.info("Onboarding completed successfully", {
            shouldRelaunch,
            state: input,
          });

          return {
            success: true,
            shouldRelaunch,
          };
        } catch (error) {
          logger.main.error("Failed to complete onboarding:", error);
          throw error;
        }
      },
    ),

  /**
   * Cancel onboarding
   */
  cancel: procedure.mutation(async () => {
    try {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        throw new Error("ServiceManager not available");
      }
      const onboardingManager = serviceManager.getOnboardingManager();

      if (!onboardingManager) {
        throw new Error("OnboardingManager not available");
      }

      await onboardingManager.cancelOnboarding();

      return { success: true };
    } catch (error) {
      logger.main.error("Failed to cancel onboarding:", error);
      throw error;
    }
  }),

  /**
   * Reset onboarding state (for testing)
   */
  reset: procedure.mutation(async () => {
    try {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        throw new Error("ServiceManager not available");
      }
      const onboardingService = serviceManager.getOnboardingService();

      if (!onboardingService) {
        throw new Error("OnboardingService not available");
      }

      await onboardingService.resetOnboarding();
      logger.main.info("Onboarding state reset");

      return { success: true };
    } catch (error) {
      logger.main.error("Failed to reset onboarding:", error);
      throw error;
    }
  }),

  /**
   * Get skipped screens based on feature flags
   */
  getSkippedScreens: procedure.query(async () => {
    try {
      const serviceManager = ServiceManager.getInstance();
      if (!serviceManager) {
        return [];
      }
      const onboardingService = serviceManager.getOnboardingService();

      if (!onboardingService) {
        return [];
      }

      const skippedScreens = onboardingService.getSkippedScreens();
      return skippedScreens;
    } catch (error) {
      logger.main.error("Failed to get skipped screens:", error);
      return [];
    }
  }),
});
