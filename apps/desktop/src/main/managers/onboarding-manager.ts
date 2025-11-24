import { app } from "electron";
import { logger } from "../logger";
import type { WindowManager } from "../core/window-manager";
import type { OnboardingService } from "../../services/onboarding-service";
import type { OnboardingState } from "../../types/onboarding";

export class OnboardingManager {
  private windowManager: WindowManager;
  private onboardingService: OnboardingService;
  private isOnboardingInProgress = false;

  constructor(
    windowManager: WindowManager,
    onboardingService: OnboardingService,
  ) {
    this.windowManager = windowManager;
    this.onboardingService = onboardingService;
  }

  /**
   * Initialize onboarding manager
   */
  async initialize(): Promise<void> {
    logger.main.info("Initializing OnboardingManager");
    // Any initialization logic can go here
  }

  /**
   * Start the onboarding flow
   */
  async startOnboarding(): Promise<void> {
    if (this.isOnboardingInProgress) {
      logger.main.warn("Onboarding already in progress");
      return;
    }

    this.isOnboardingInProgress = true;
    logger.main.info("Starting onboarding flow");

    // Create and show the onboarding window
    await this.windowManager.createOrShowOnboardingWindow();

    // Track onboarding started event
    this.onboardingService.trackOnboardingStarted(process.platform);
  }

  /**
   * Complete the onboarding process
   */
  async completeOnboarding(finalState: OnboardingState): Promise<void> {
    try {
      logger.main.info("Completing onboarding");

      // Save the final state
      await this.onboardingService.completeOnboarding(finalState);

      this.isOnboardingInProgress = false;

      // Close onboarding window
      const onboardingWindow = this.windowManager.getOnboardingWindow();
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.close();
      }

      // Determine if we need to relaunch
      const isDevelopment = process.env.NODE_ENV === "development";

      if (isDevelopment) {
        // In development, reload windows
        logger.main.info("Development mode: Reloading windows");
        await this.reloadWindows();
      } else {
        // In production, relaunch the app
        logger.main.info("Production mode: Relaunching app");
        this.relaunchApp();
      }
    } catch (error) {
      logger.main.error("Error completing onboarding:", error);
      throw error;
    }
  }

  /**
   * Handle onboarding cancellation
   */
  async cancelOnboarding(): Promise<void> {
    logger.main.info("Onboarding cancelled");

    this.isOnboardingInProgress = false;

    // Track abandonment event
    const currentState = await this.onboardingService.getOnboardingState();
    const lastScreen =
      currentState?.lastVisitedScreen ||
      currentState?.skippedScreens?.[currentState.skippedScreens.length - 1] ||
      "unknown";
    this.onboardingService.trackOnboardingAbandoned(lastScreen);

    // Close the onboarding window
    const onboardingWindow = this.windowManager.getOnboardingWindow();
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.close();
    }

    // Quit the app since onboarding was not completed
    app.quit();
  }

  /**
   * Reload windows in development mode
   */
  private async reloadWindows(): Promise<void> {
    try {
      // Create main window
      await this.windowManager.createOrShowMainWindow();

      // Create widget window if enabled
      const settings = await this.onboardingService.getOnboardingState();
      if (settings?.featureInterests?.includes("contextual_dictation" as any)) {
        await this.windowManager.createWidgetWindow();
      }
    } catch (error) {
      logger.main.error("Error reloading windows:", error);
    }
  }

  /**
   * Relaunch the application in production mode
   */
  private relaunchApp(): void {
    app.relaunch();
    app.quit();
  }

  /**
   * Check if onboarding is currently in progress
   */
  isInProgress(): boolean {
    return this.isOnboardingInProgress;
  }

  /**
   * Get the current onboarding state
   */
  async getState(): Promise<OnboardingState | null> {
    return this.onboardingService.getOnboardingState();
  }

  /**
   * Update onboarding preferences
   */
  async updatePreferences(preferences: any): Promise<void> {
    return this.onboardingService.savePreferences(preferences);
  }

  /**
   * Get system model recommendation
   */
  async getSystemRecommendation(): Promise<any> {
    return this.onboardingService.getSystemRecommendation();
  }

  /**
   * Get feature flags for onboarding
   */
  getFeatureFlags(): any {
    return this.onboardingService.getFeatureFlags();
  }
}
