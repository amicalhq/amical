import { z } from "zod";
import { systemPreferences, shell, app } from "electron";
import os from "node:os";
import path from "node:path";
import { createRouter, procedure } from "../trpc";
import {
  OnboardingPreferencesSchema,
  OnboardingStateSchema,
} from "../../types/onboarding";
import { logger } from "../../main/logger";

export const onboardingRouter = createRouter({
  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /**
   * Get current onboarding state from database
   */
  getState: procedure.query(async ({ ctx }) => {
    try {
      const { serviceManager } = ctx;
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
   * Get recommended local model ID based on hardware
   */
  getRecommendedLocalModel: procedure.query(({ ctx }): string => {
    const { serviceManager } = ctx;
    if (!serviceManager) {
      return "whisper-base";
    }
    const onboardingService = serviceManager.getOnboardingService();
    if (!onboardingService) {
      return "whisper-base";
    }
    return onboardingService.getRecommendedLocalModelId();
  }),

  /**
   * Check if onboarding is needed
   */
  needsOnboarding: procedure.query(async ({ ctx }) => {
    try {
      const { serviceManager } = ctx;
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

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  /**
   * Save onboarding preferences (called after each screen)
   */
  savePreferences: procedure
    .input(OnboardingPreferencesSchema)
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{ success: boolean; message?: string }> => {
        try {
          const { serviceManager } = ctx;
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
   * Complete onboarding and save final state
   */
  complete: procedure
    .input(OnboardingStateSchema)
    .mutation(async ({ input, ctx }): Promise<{ success: boolean }> => {
      try {
        const { serviceManager } = ctx;
        if (!serviceManager) {
          throw new Error("ServiceManager not available");
        }
        const onboardingService = serviceManager.getOnboardingService();

        if (!onboardingService) {
          throw new Error("OnboardingService not available");
        }

        // Complete onboarding through the service
        // AppManager handles window closing and relaunch decision
        await onboardingService.completeOnboardingFlow(input);

        logger.main.info("Onboarding completed successfully", {
          state: input,
        });

        return { success: true };
      } catch (error) {
        logger.main.error("Failed to complete onboarding:", error);
        throw error;
      }
    }),

  /**
   * Cancel onboarding
   */
  cancel: procedure.mutation(async ({ ctx }) => {
    try {
      const { serviceManager } = ctx;
      if (!serviceManager) {
        throw new Error("ServiceManager not available");
      }
      const onboardingService = serviceManager.getOnboardingService();

      if (!onboardingService) {
        throw new Error("OnboardingService not available");
      }

      await onboardingService.cancelOnboardingFlow();

      return { success: true };
    } catch (error) {
      logger.main.error("Failed to cancel onboarding:", error);
      throw error;
    }
  }),

  /**
   * Reset onboarding state (for testing)
   */
  reset: procedure.mutation(async ({ ctx }) => {
    try {
      const { serviceManager } = ctx;
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
  getSkippedScreens: procedure.query(async ({ ctx }) => {
    try {
      const { serviceManager } = ctx;
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

  /**
   * Check microphone permission status
   */
  checkMicrophonePermission: procedure.query(async (): Promise<string> => {
    try {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      logger.main.debug("Microphone permission status:", status);
      return status;
    } catch (error) {
      logger.main.error("Failed to check microphone permission:", error);
      return "not-determined";
    }
  }),

  /**
   * Check accessibility permission status
   */
  checkAccessibilityPermission: procedure.query(async (): Promise<boolean> => {
    try {
      // For non-macOS platforms, accessibility permission is not required
      if (process.platform !== "darwin") {
        return true;
      }

      const hasPermission =
        systemPreferences.isTrustedAccessibilityClient(false);
      logger.main.debug("Accessibility permission status:", hasPermission);
      return hasPermission;
    } catch (error) {
      logger.main.error("Failed to check accessibility permission:", error);
      return false;
    }
  }),

  /**
   * Get current platform
   */
  getPlatform: procedure.query(async (): Promise<string> => {
    return process.platform;
  }),

  /**
   * Get current computer user name for personalization
   */
  getComputerUserName: procedure.query(async (): Promise<string> => {
    try {
      const homeDirUser = path.basename(os.homedir()).trim();
      const systemUserName = os.userInfo().username || "";
      const normalizedUserName =
        systemUserName.split("\\").pop()?.split("/").pop()?.trim() ||
        systemUserName.trim();

      return normalizedUserName || homeDirUser || "You";
    } catch (error) {
      logger.main.error("Failed to get computer user name:", error);
      return path.basename(os.homedir()).trim() || "You";
    }
  }),

  /**
   * Request microphone permission
   */
  requestMicrophonePermission: procedure.mutation(
    async (): Promise<boolean> => {
      try {
        const status = await systemPreferences.askForMediaAccess("microphone");
        logger.main.info("Microphone permission requested, status:", status);
        return status;
      } catch (error) {
        logger.main.error("Failed to request microphone permission:", error);
        return false;
      }
    },
  ),

  /**
   * Request accessibility permission (opens System Preferences)
   */
  requestAccessibilityPermission: procedure.mutation(
    async (): Promise<void> => {
      try {
        if (process.platform === "darwin") {
          // Prompt for accessibility permission (shows system dialog)
          systemPreferences.isTrustedAccessibilityClient(true);

          // Open System Preferences to Privacy & Security > Accessibility
          await shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          );

          logger.main.info(
            "Opened System Preferences for accessibility permission",
          );
        }
      } catch (error) {
        logger.main.error("Failed to request accessibility permission:", error);
        throw error;
      }
    },
  ),

  /**
   * Quit the application
   */
  quitApp: procedure.mutation(async (): Promise<void> => {
    try {
      logger.main.info("Quitting application from onboarding");
      app.quit();
    } catch (error) {
      logger.main.error("Failed to quit application:", error);
      throw error;
    }
  }),

  /**
   * Open external URL
   */
  openExternal: procedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }): Promise<void> => {
      try {
        await shell.openExternal(input.url);
        logger.main.debug("Opened external URL:", input.url);
      } catch (error) {
        logger.main.error("Failed to open external URL:", error);
        throw error;
      }
    }),

  /**
   * Log error message
   */
  logError: procedure
    .input(
      z.object({
        message: z.string(),
        args: z.array(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }): Promise<void> => {
      try {
        logger.main.error(
          `[Onboarding] ${input.message}`,
          ...(input.args || []),
        );
      } catch (error) {
        // Fallback if logging fails
        console.error("Failed to log error:", error);
      }
    }),
});
