import { logger } from "../main/logger";
import type { SettingsService } from "./settings-service";
import type { TelemetryService } from "./telemetry-service";
import type { AppSettingsData } from "../db/schema";
import type {
  OnboardingState,
  OnboardingPreferences,
  ModelRecommendation,
  ModelType,
  OnboardingScreen,
  OnboardingFeatureFlags,
  SystemSpecs,
  FeatureInterest,
  DiscoverySource,
} from "../types/onboarding";

/**
 * Database representation of onboarding state
 * Enums are stored as strings in SQLite
 */
type OnboardingStateDb = {
  completedVersion?: number;
  completedAt?: string;
  lastUpdated?: string;
  skippedScreens?: string[];
  featureInterests?: string[];
  discoverySource?: string;
  selectedModelType?: "cloud" | "local";
  modelRecommendation?: {
    suggested: "cloud" | "local";
    reason: string;
    followed: boolean;
  };
};

export class OnboardingService {
  private static instance: OnboardingService | null = null;
  private settingsService: SettingsService;
  private telemetryService: TelemetryService;
  private currentState: Partial<OnboardingState> = {};

  constructor(
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ) {
    this.settingsService = settingsService;
    this.telemetryService = telemetryService;
  }

  static getInstance(
    settingsService: SettingsService,
    telemetryService: TelemetryService,
  ): OnboardingService {
    if (!OnboardingService.instance) {
      OnboardingService.instance = new OnboardingService(
        settingsService,
        telemetryService,
      );
    }
    return OnboardingService.instance;
  }

  /**
   * Get the current onboarding state from the database
   */
  async getOnboardingState(): Promise<OnboardingState | null> {
    try {
      const settings = await this.settingsService.getAllSettings();
      if (!settings.onboarding) {
        return null;
      }

      // Convert database types to OnboardingState types
      return {
        ...settings.onboarding,
        skippedScreens: settings.onboarding.skippedScreens as
          | OnboardingScreen[]
          | undefined,
        featureInterests: settings.onboarding.featureInterests as
          | FeatureInterest[]
          | undefined,
        discoverySource: settings.onboarding.discoverySource as
          | DiscoverySource
          | undefined,
        selectedModelType: settings.onboarding.selectedModelType as ModelType,
      } as OnboardingState;
    } catch (error) {
      logger.main.error("Failed to get onboarding state:", error);
      return null;
    }
  }

  /**
   * Save the onboarding state to the database
   */
  async saveOnboardingState(state: Partial<OnboardingState>): Promise<void> {
    try {
      const currentSettings = await this.settingsService.getAllSettings();

      // Convert OnboardingState types to database types (strings)
      const stateForDb: OnboardingStateDb = {
        ...currentSettings.onboarding,
      };

      // Ensure enums are stored as strings in the database
      if (state.skippedScreens !== undefined) {
        stateForDb.skippedScreens = state.skippedScreens.map(
          (s) => s as string,
        );
      }
      if (state.featureInterests !== undefined) {
        stateForDb.featureInterests = state.featureInterests.map(
          (f) => f as string,
        );
      }
      if (state.discoverySource !== undefined) {
        stateForDb.discoverySource = state.discoverySource as string;
      }
      if (state.selectedModelType !== undefined) {
        stateForDb.selectedModelType = state.selectedModelType as
          | "cloud"
          | "local";
      }
      if (state.completedVersion !== undefined) {
        stateForDb.completedVersion = state.completedVersion;
      }
      if (state.completedAt !== undefined) {
        stateForDb.completedAt = state.completedAt;
      }
      if (state.modelRecommendation !== undefined) {
        stateForDb.modelRecommendation = {
          suggested: state.modelRecommendation.suggested as "cloud" | "local",
          reason: state.modelRecommendation.reason,
          followed: state.modelRecommendation.followed,
        };
      }

      await this.settingsService.updateSettings({
        onboarding: stateForDb as AppSettingsData["onboarding"],
      });

      this.currentState = state;
      logger.main.debug("Saved onboarding state:", stateForDb);
    } catch (error) {
      logger.main.error("Failed to save onboarding state:", error);
      throw error;
    }
  }

  /**
   * Save user preferences during onboarding
   * T030, T031 - Implements savePreferences with partial progress saving
   */
  async savePreferences(preferences: OnboardingPreferences): Promise<void> {
    try {
      const updates: Partial<OnboardingState> = {};

      if (preferences.featureInterests !== undefined) {
        updates.featureInterests = preferences.featureInterests;
      }
      if (preferences.discoverySource !== undefined) {
        updates.discoverySource = preferences.discoverySource;
      }
      if (preferences.selectedModelType !== undefined) {
        updates.selectedModelType = preferences.selectedModelType;
      }
      if (preferences.modelRecommendation !== undefined) {
        updates.modelRecommendation = preferences.modelRecommendation;
      }

      // T032 - Save partial progress after each screen
      await this.savePartialProgress(updates);
      logger.main.info("Saved onboarding preferences:", preferences);
    } catch (error) {
      logger.main.error("Failed to save preferences:", error);
      throw error;
    }
  }

  /**
   * Save partial onboarding progress
   * T032, T033 - Database read/write for partial state
   */
  async savePartialProgress(
    partialState: Partial<OnboardingState>,
  ): Promise<void> {
    try {
      // Read current state
      const currentState = await this.getOnboardingState();

      // Merge with partial update
      const mergedState = {
        ...currentState,
        ...partialState,
      };

      // Write back to database
      await this.saveOnboardingState(mergedState);

      logger.main.debug("Saved partial onboarding progress:", partialState);
    } catch (error) {
      logger.main.error("Failed to save partial progress:", error);
      throw error;
    }
  }

  /**
   * Read onboarding progress from database
   * T033 - Database read method for onboarding state
   */
  async readOnboardingProgress(): Promise<OnboardingState | null> {
    try {
      return await this.getOnboardingState();
    } catch (error) {
      logger.main.error("Failed to read onboarding progress:", error);
      return null;
    }
  }

  /**
   * Write onboarding progress to database
   * T033 - Database write method for onboarding state
   */
  async writeOnboardingProgress(state: OnboardingState): Promise<void> {
    try {
      await this.saveOnboardingState(state);
    } catch (error) {
      logger.main.error("Failed to write onboarding progress:", error);
      throw error;
    }
  }

  /**
   * Complete the onboarding process
   */
  async completeOnboarding(finalState: OnboardingState): Promise<void> {
    try {
      // Ensure completedAt timestamp is set
      const completeState = {
        ...finalState,
        completedAt: finalState.completedAt || new Date().toISOString(),
      };

      await this.saveOnboardingState(completeState);

      // Track completion event if telemetry is enabled
      if (this.telemetryService.isEnabled()) {
        this.telemetryService.track("onboarding_completed", {
          version: completeState.completedVersion,
          features: completeState.featureInterests,
          model: completeState.selectedModelType,
          followed_recommendation: completeState.modelRecommendation?.followed,
          skipped_screens: completeState.skippedScreens,
        });
      }

      logger.main.info("Onboarding completed successfully");
    } catch (error) {
      logger.main.error("Failed to complete onboarding:", error);
      throw error;
    }
  }

  /**
   * Check if onboarding is needed
   */
  async checkNeedsOnboarding(): Promise<{
    needed: boolean;
    reason: {
      forceOnboarding: boolean;
      notCompleted: boolean;
      missingPermissions: boolean;
    };
  }> {
    const forceOnboarding = process.env.FORCE_ONBOARDING === "true";
    const state = await this.getOnboardingState();
    const hasCompleted = state?.completedVersion
      ? state.completedVersion >= 1
      : false;

    // For now, we'll assume permissions are checked elsewhere
    // This will be integrated with the actual permission checking in Phase 3
    const missingPermissions = false;

    const needed = forceOnboarding || !hasCompleted || missingPermissions;

    return {
      needed,
      reason: {
        forceOnboarding,
        notCompleted: !hasCompleted,
        missingPermissions,
      },
    };
  }

  /**
   * Check for NVIDIA RTX 30 series or newer
   */
  private hasNvidia30SeriesOrBetter(gpuModel: string): boolean {
    if (!gpuModel) return false;

    const rtx30SeriesAndNewer = [
      "RTX 3060",
      "RTX 3070",
      "RTX 3080",
      "RTX 3090",
      "RTX 4060",
      "RTX 4070",
      "RTX 4080",
      "RTX 4090",
      "RTX 5060",
      "RTX 5070",
      "RTX 5080",
      "RTX 5090", // Future-proofing
      "RTX A4000",
      "RTX A5000",
      "RTX A6000", // Professional cards
    ];

    const upperGpuModel = gpuModel.toUpperCase();
    return rtx30SeriesAndNewer.some((model) => upperGpuModel.includes(model));
  }

  /**
   * Check for Apple Silicon M2 or newer
   */
  private hasAppleSiliconM2OrBetter(cpuModel?: string): boolean {
    // Must be Apple Silicon Mac first
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      return false;
    }

    // If no CPU model info, can't determine specific chip
    if (!cpuModel) return false;

    const upperCpuModel = cpuModel.toUpperCase();

    // Check for M2, M3, M4 and future chips
    // M1 chips will return false
    const m2OrNewerChips = ["M2", "M3", "M4", "M5", "M6"]; // Future-proofing

    return m2OrNewerChips.some((chip) =>
      upperCpuModel.includes(`APPLE ${chip}`),
    );
  }

  /**
   * Calculate model recommendation based on system specs
   */
  calculateModelRecommendation(systemInfo: SystemSpecs): ModelRecommendation {
    const gpuModel = systemInfo.gpu_model || "";
    const cpuModel = systemInfo.cpu_model || "";

    // Check for powerful GPU or Apple Silicon M2+
    const hasNvidiaGPU = this.hasNvidia30SeriesOrBetter(gpuModel);
    const hasM2OrBetter = this.hasAppleSiliconM2OrBetter(cpuModel);

    if (hasNvidiaGPU || hasM2OrBetter) {
      return {
        suggested: "local" as ModelType,
        reason:
          "Your system has sufficient resources for local models, offering better privacy and offline capability.",
        systemSpecs: {
          cpu_cores: systemInfo.cpu_cores,
          memory_total_gb: systemInfo.memory_total_gb,
        },
      };
    }

    // Default to cloud for everything else (including M1 chips)
    return {
      suggested: "cloud" as ModelType,
      reason:
        "Your system may experience slow performance with local models. Cloud processing is recommended for optimal speed.",
      systemSpecs: {
        cpu_cores: systemInfo.cpu_cores,
        memory_total_gb: systemInfo.memory_total_gb,
      },
    };
  }

  /**
   * Get system recommendation for model selection
   */
  async getSystemRecommendation(): Promise<ModelRecommendation> {
    try {
      // Check for mock system specs (for testing)
      if (process.env.MOCK_SYSTEM_SPECS) {
        const mockSpecs = JSON.parse(
          process.env.MOCK_SYSTEM_SPECS,
        ) as SystemSpecs;
        return this.calculateModelRecommendation(mockSpecs);
      }

      // Get real system info from telemetry service
      const systemInfo = this.telemetryService.getSystemInfo();
      if (!systemInfo) {
        // Fallback if system info not available
        return {
          suggested: "cloud" as ModelType,
          reason:
            "Unable to detect system specifications. Cloud processing is recommended.",
        };
      }

      const specs: SystemSpecs = {
        cpu_model: systemInfo.cpu_model,
        cpu_cores: systemInfo.cpu_cores,
        cpu_threads: systemInfo.cpu_threads,
        cpu_speed_ghz: systemInfo.cpu_speed_ghz,
        memory_total_gb: systemInfo.memory_total_gb,
        gpu_model: systemInfo.gpu_model,
        gpu_vendor: systemInfo.gpu_vendor,
      };

      return this.calculateModelRecommendation(specs);
    } catch (error) {
      logger.main.error("Failed to get system recommendation:", error);
      // Fallback recommendation on error
      return {
        suggested: "cloud" as ModelType,
        reason:
          "Unable to analyze system specifications. Cloud processing is recommended.",
      };
    }
  }

  /**
   * Get feature flags for onboarding screens
   */
  getFeatureFlags(): OnboardingFeatureFlags {
    return {
      skipWelcome: process.env.ONBOARDING_SKIP_WELCOME === "true",
      skipFeatures: process.env.ONBOARDING_SKIP_FEATURES === "true",
      skipDiscovery: process.env.ONBOARDING_SKIP_DISCOVERY === "true",
      skipModels: process.env.ONBOARDING_SKIP_MODELS === "true",
    };
  }

  /**
   * Get screens to skip based on feature flags
   */
  getSkippedScreens(): OnboardingScreen[] {
    const flags = this.getFeatureFlags();
    const skipped: OnboardingScreen[] = [];

    if (flags.skipWelcome) skipped.push("welcome" as OnboardingScreen);
    if (flags.skipFeatures) skipped.push("features" as OnboardingScreen);
    if (flags.skipDiscovery) skipped.push("discovery" as OnboardingScreen);
    if (flags.skipModels) skipped.push("models" as OnboardingScreen);

    return skipped;
  }

  /**
   * Track onboarding event
   */
  trackEvent(eventName: string, properties?: Record<string, any>): void {
    if (this.telemetryService.isEnabled()) {
      this.telemetryService.track(eventName, {
        ...properties,
        onboarding_session: this.currentState,
      });
    }
  }

  /**
   * Reset onboarding state (for testing)
   */
  async resetOnboarding(): Promise<void> {
    try {
      await this.settingsService.updateSettings({
        onboarding: undefined,
      });
      this.currentState = {};
      logger.main.info("Onboarding state reset");
    } catch (error) {
      logger.main.error("Failed to reset onboarding:", error);
      throw error;
    }
  }
}
