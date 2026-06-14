import { EventEmitter } from "events";
import { systemPreferences } from "electron";
import { logger } from "../main/logger";
import type { SettingsService } from "./settings-service";
import type { TelemetryService } from "./telemetry-service";
import type { ModelService } from "./model-service";
import type { AppSettingsData } from "../db/schema";
import { isLocalTranscriptionSupported } from "../utils/os-version";
import {
  OnboardingScreen,
  FeatureInterest,
  type OnboardingState,
  type OnboardingPreferences,
  type ModelRecommendation,
  type ModelType,
  type OnboardingFeatureFlags,
  type SystemSpecs,
  type DiscoverySource,
} from "../types/onboarding";

/**
 * Database representation of onboarding state
 * Enums are stored as strings in SQLite
 */
type OnboardingStateDb = {
  completedVersion?: number;
  completedAt?: string;
  lastUpdated?: string;
  lastVisitedScreen?: string;
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

export class OnboardingService extends EventEmitter {
  private static instance: OnboardingService | null = null;
  private settingsService: SettingsService;
  private telemetryService: TelemetryService;
  private modelService: ModelService;
  private isOnboardingInProgress = false;

  constructor(
    settingsService: SettingsService,
    telemetryService: TelemetryService,
    modelService: ModelService,
  ) {
    super();
    this.settingsService = settingsService;
    this.telemetryService = telemetryService;
    this.modelService = modelService;
  }

  static getInstance(
    settingsService: SettingsService,
    telemetryService: TelemetryService,
    modelService: ModelService,
  ): OnboardingService {
    if (!OnboardingService.instance) {
      OnboardingService.instance = new OnboardingService(
        settingsService,
        telemetryService,
        modelService,
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

      // Validate lastVisitedScreen is a valid enum value
      let lastVisitedScreen: OnboardingScreen | undefined = undefined;
      if (settings.onboarding.lastVisitedScreen) {
        const screenValue = settings.onboarding.lastVisitedScreen;
        if (
          Object.values(OnboardingScreen).includes(
            screenValue as OnboardingScreen,
          )
        ) {
          lastVisitedScreen = screenValue as OnboardingScreen;
        } else {
          logger.main.warn(
            `Invalid lastVisitedScreen value in database: "${screenValue}". Resetting to undefined.`,
          );
        }
      }

      // Convert database types to OnboardingState types
      return {
        ...settings.onboarding,
        lastVisitedScreen,
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
      if (state.lastVisitedScreen !== undefined) {
        // Convert enum to string for database storage
        // TypeScript enums have string values at runtime, so this cast is safe
        stateForDb.lastVisitedScreen = state.lastVisitedScreen as string;
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

      logger.main.debug("Saved onboarding state:", stateForDb);
    } catch (error) {
      logger.main.error("Failed to save onboarding state:", error);
      throw error;
    }
  }

  /**
   * Save user preferences during onboarding
   * T030, T031 - Implements savePreferences with partial progress saving
   * Also tracks telemetry for each preference type
   */
  async savePreferences(preferences: OnboardingPreferences): Promise<void> {
    try {
      const updates: Partial<OnboardingState> = {};

      // Track screen view when lastVisitedScreen changes
      if (preferences.lastVisitedScreen !== undefined) {
        updates.lastVisitedScreen = preferences.lastVisitedScreen;
        this.telemetryService.trackOnboardingScreenViewed({
          screen: preferences.lastVisitedScreen,
        });
      }

      // Track feature interests selection
      if (preferences.featureInterests !== undefined) {
        updates.featureInterests = preferences.featureInterests;
        this.telemetryService.trackOnboardingFeaturesSelected({
          features: preferences.featureInterests,
          count: preferences.featureInterests.length,
          details: preferences.featureInterestsDetails,
        });
      }

      // Track discovery source selection
      if (preferences.discoverySource !== undefined) {
        updates.discoverySource = preferences.discoverySource;
        this.telemetryService.trackOnboardingDiscoverySelected({
          source: preferences.discoverySource,
          details: preferences.discoveryDetails,
        });
      }

      // Track model selection. The actual model is applied at completion —
      // at selection time its prerequisites don't exist yet (cloud needs the
      // sign-in screen's auth, local needs the download screen's model), so
      // applying here would throw and fail the whole preference save.
      if (preferences.selectedModelType !== undefined) {
        updates.selectedModelType = preferences.selectedModelType;
        this.telemetryService.trackOnboardingModelSelected({
          model_type: preferences.selectedModelType,
          recommendation_followed:
            preferences.modelRecommendation?.followed ?? false,
        });
      }

      if (preferences.modelRecommendation !== undefined) {
        updates.modelRecommendation = preferences.modelRecommendation;
      }

      // T032 - Save partial progress after each screen
      await this.savePartialProgress(updates);
      logger.main.debug("Saved onboarding preferences:", preferences);
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
   * Apply the chosen speech model once its prerequisite exists — cloud needs the
   * sign-in screen's auth, local needs the download screen's model. Called when
   * each prerequisite completes (so the try-it segment has a usable model rather
   * than firing "no model selected"), and again at completion as a safety net.
   * Idempotent and best-effort: never throws, and leaves an existing selection
   * untouched.
   */
  async applySelectedModel(): Promise<void> {
    try {
      const state = await this.getOnboardingState();
      const modelType = state?.selectedModelType;

      if (modelType === "cloud") {
        const current = await this.modelService.getSelectedModel();
        if (current === "amical-cloud") return;
        await this.modelService.setSelectedModel("amical-cloud");
        logger.main.info("Set default speech model to amical-cloud");
      } else if (modelType === "local") {
        // Keep an existing selection if any, otherwise use first downloaded model
        const current = await this.modelService.getSelectedModel();
        if (current) return;
        const downloadedIds = Object.keys(
          await this.modelService.getDownloadedModels(),
        );
        if (downloadedIds.length > 0) {
          await this.modelService.setSelectedModel(downloadedIds[0]);
          logger.main.info(`Set default speech model to ${downloadedIds[0]}`);
        }
      }
    } catch (error) {
      logger.main.error("Failed to apply selected speech model:", error);
    }
  }

  /**
   * Complete the onboarding process
   */
  async completeOnboarding(finalState: OnboardingState): Promise<void> {
    try {
      // Merge over what's already persisted: after a quit-and-resume the
      // renderer's in-memory preferences are empty, and the survey answers
      // live only in the database — without this the completion event ships
      // with no features/discovery/recommendation.
      const persisted = await this.getOnboardingState();
      const completeState: OnboardingState = {
        ...finalState,
        completedAt: finalState.completedAt || new Date().toISOString(),
        skippedScreens: finalState.skippedScreens?.length
          ? finalState.skippedScreens
          : persisted?.skippedScreens,
        featureInterests:
          finalState.featureInterests ?? persisted?.featureInterests,
        discoverySource:
          finalState.discoverySource ?? persisted?.discoverySource,
        modelRecommendation:
          finalState.modelRecommendation ?? persisted?.modelRecommendation,
      };

      await this.saveOnboardingState(completeState);

      // Apply the chosen speech model as a safety net — normally already done
      // when the sign-in/download prerequisite completed. Best-effort; never
      // blocks completion.
      await this.applySelectedModel();

      // Track completion event
      this.telemetryService.trackOnboardingCompleted({
        version: completeState.completedVersion,
        features_selected: completeState.featureInterests || [],
        discovery_source: completeState.discoverySource,
        model_type: completeState.selectedModelType,
        recommendation_followed:
          completeState.modelRecommendation?.followed || false,
        skipped_screens: completeState.skippedScreens,
      });

      logger.main.info("Onboarding completed successfully");
    } catch (error) {
      logger.main.error("Failed to complete onboarding:", error);
      throw error;
    }
  }

  /**
   * Check system permissions (can be called anytime)
   * Returns current microphone and accessibility permission status
   */
  checkSystemPermissions(): {
    microphone: boolean;
    accessibility: boolean;
  } {
    const microphone =
      systemPreferences.getMediaAccessStatus("microphone") === "granted";

    const accessibility =
      process.platform === "darwin"
        ? systemPreferences.isTrustedAccessibilityClient(false)
        : true; // Non-macOS platforms don't need accessibility permission

    return { microphone, accessibility };
  }

  /**
   * Check if onboarding is needed
   * Returns true if user needs to go through onboarding (first time or missing permissions)
   */
  async checkNeedsOnboarding(): Promise<{
    needed: boolean;
    reason: {
      forceOnboarding: boolean;
      notCompleted: boolean;
      missingPermissions: boolean;
    };
    missingPermissions: {
      microphone: boolean;
      accessibility: boolean;
    };
  }> {
    const forceOnboarding = process.env.FORCE_ONBOARDING === "true";
    const state = await this.getOnboardingState();
    logger.main.info("Onboarding state:", state);
    const hasCompleted = state?.completedVersion
      ? state.completedVersion >= 1
      : false;

    // Check actual system permissions
    const permissions = this.checkSystemPermissions();
    const hasMissingPermissions =
      !permissions.microphone || !permissions.accessibility;

    const needed = forceOnboarding || !hasCompleted || hasMissingPermissions;

    return {
      needed,
      reason: {
        forceOnboarding,
        notCompleted: !hasCompleted,
        missingPermissions: hasMissingPermissions,
      },
      missingPermissions: {
        microphone: !permissions.microphone,
        accessibility: !permissions.accessibility,
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
   * Check for high-end hardware (RTX 50 series or M3 Pro/Max/M4)
   */
  private hasHighEndHardware(gpuModel: string, cpuModel: string): boolean {
    const upperGpu = gpuModel.toUpperCase();
    const upperCpu = cpuModel.toUpperCase();

    // RTX 50 series
    const hasRtx50 = ["RTX 5060", "RTX 5070", "RTX 5080", "RTX 5090"].some(
      (m) => upperGpu.includes(m),
    );

    // M3 Pro/Max or M4+
    const hasM3ProMax =
      upperCpu.includes("M3 PRO") || upperCpu.includes("M3 MAX");
    const hasM4Plus = ["M4", "M5", "M6"].some((chip) =>
      upperCpu.includes(`APPLE ${chip}`),
    );

    return hasRtx50 || hasM3ProMax || hasM4Plus;
  }

  /**
   * Check for NVIDIA RTX 20 series
   */
  private hasNvidia20Series(gpuModel: string): boolean {
    if (!gpuModel) return false;
    const upperGpu = gpuModel.toUpperCase();
    return ["RTX 2060", "RTX 2070", "RTX 2080"].some((m) =>
      upperGpu.includes(m),
    );
  }

  /**
   * Check for Apple Silicon M1
   */
  private hasAppleSiliconM1(cpuModel: string): boolean {
    if (process.platform !== "darwin" || process.arch !== "arm64") return false;
    return cpuModel.toUpperCase().includes("APPLE M1");
  }

  /**
   * Get recommended local model ID based on hardware
   * - High-end (RTX 50, M3 Pro/Max, M4+) → whisper-large-v3-turbo
   * - Mid-tier (RTX 30/40, M2/M3 base) → whisper-medium
   * - Entry (RTX 20, M1) → whisper-small
   * - Default → whisper-base
   */
  getRecommendedLocalModelId(): string {
    const systemInfo = this.telemetryService.getSystemInfo();
    const gpuModel = systemInfo?.gpu_model || "";
    const cpuModel = systemInfo?.cpu_model || "";

    // High-end: RTX 50 series or M3 Pro/Max/M4+
    if (this.hasHighEndHardware(gpuModel, cpuModel)) {
      return "whisper-large-v3-turbo";
    }

    // Mid-tier: RTX 30/40 series or M2/M3 base
    if (
      this.hasNvidia30SeriesOrBetter(gpuModel) ||
      this.hasAppleSiliconM2OrBetter(cpuModel)
    ) {
      return "whisper-medium";
    }

    // Entry: RTX 20 series or M1
    if (this.hasNvidia20Series(gpuModel) || this.hasAppleSiliconM1(cpuModel)) {
      return "whisper-small";
    }

    return "whisper-base";
  }

  /**
   * Calculate model recommendation based on system specs
   */
  calculateModelRecommendation(systemInfo: SystemSpecs): ModelRecommendation {
    const systemSpecs = {
      cpu_cores: systemInfo.cpu_cores,
      memory_total_gb: systemInfo.memory_total_gb,
    };

    // Local (on-device) models can't run on macOS < 15 — never recommend them
    // there, so the "Recommended" badge doesn't land on a disabled option.
    if (!isLocalTranscriptionSupported()) {
      return {
        suggested: "cloud" as ModelType,
        reason:
          "On-device models require macOS 15 or later. Cloud transcription is recommended.",
        systemSpecs,
      };
    }

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
        systemSpecs,
      };
    }

    // Default to cloud for everything else (including M1 chips)
    return {
      suggested: "cloud" as ModelType,
      reason:
        "Your system may experience slow performance with local models. Cloud processing is recommended for optimal speed.",
      systemSpecs,
    };
  }

  /**
   * Get system recommendation for model selection
   */
  async getSystemRecommendation(): Promise<ModelRecommendation> {
    try {
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
   * Get screens to skip based on feature flags. The use-case chips live on
   * Welcome now, so the legacy skipFeatures flag maps there too — "features"
   * is not a screen id and must never reach skipped_screens telemetry.
   */
  getSkippedScreens(): OnboardingScreen[] {
    const flags = this.getFeatureFlags();
    const skipped = new Set<OnboardingScreen>();

    if (flags.skipWelcome || flags.skipFeatures) {
      skipped.add(OnboardingScreen.Welcome);
    }
    if (flags.skipDiscovery) skipped.add(OnboardingScreen.DiscoverySource);
    if (flags.skipModels) skipped.add(OnboardingScreen.ModelSelection);

    return [...skipped];
  }

  /**
   * Track onboarding started event. Resume facts come from the database —
   * the in-memory state is empty on a fresh process, which is exactly when
   * a resume happens. A completed run re-entering (FORCE_ONBOARDING, missing
   * permissions) is a re-run, not a resume.
   */
  async trackOnboardingStarted(platform: string): Promise<void> {
    const persisted = await this.getOnboardingState();
    const resumedFrom = persisted?.completedVersion
      ? undefined
      : persisted?.lastVisitedScreen;
    this.telemetryService.trackOnboardingStarted({
      platform,
      resumed: !!resumedFrom,
      resumedFrom,
    });
  }

  /**
   * Track onboarding abandoned event
   */
  trackOnboardingAbandoned(lastScreen: string): void {
    this.telemetryService.trackOnboardingAbandoned({
      last_screen: lastScreen,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track how an optional step was exited (did the thing vs moved past it)
   */
  trackStepResult(
    screen: OnboardingScreen,
    outcome: "completed" | "skipped",
  ): void {
    this.telemetryService.trackOnboardingStepResult({ screen, outcome });
  }

  /**
   * Reset onboarding state (for testing)
   */
  async resetOnboarding(): Promise<void> {
    try {
      await this.settingsService.updateSettings({
        onboarding: undefined,
      });
      logger.main.info("Onboarding state reset");
    } catch (error) {
      logger.main.error("Failed to reset onboarding:", error);
      throw error;
    }
  }

  // ============================================
  // Flow methods (event-driven architecture)
  // ============================================

  /**
   * Check if onboarding is currently in progress
   */
  isInProgress(): boolean {
    return this.isOnboardingInProgress;
  }

  /**
   * Start the onboarding flow
   * Note: Window creation is handled by AppManager
   */
  async startOnboardingFlow(): Promise<void> {
    if (this.isOnboardingInProgress) {
      logger.main.warn("Onboarding already in progress");
      return;
    }

    this.isOnboardingInProgress = true;
    logger.main.info("Starting onboarding flow");

    // Track onboarding started event
    await this.trackOnboardingStarted(process.platform);
  }

  /**
   * Complete the onboarding flow
   * Emits "completed" event - AppManager handles window transitions
   */
  async completeOnboardingFlow(finalState: OnboardingState): Promise<void> {
    try {
      logger.main.info("Completing onboarding flow");

      // Save the final state
      await this.completeOnboarding(finalState);

      this.isOnboardingInProgress = false;

      // Emit event - AppManager listens and handles window transitions
      this.emit("completed");

      logger.main.info("Onboarding completed, emitted event");
    } catch (error) {
      logger.main.error("Error completing onboarding flow:", error);
      throw error;
    }
  }

  /**
   * Mark a dictation try-it step active/inactive.
   * Emits "try-it-active-changed" - AppManager handles shortcut suppression
   * and widget bring-up
   */
  setTryItActive(active: boolean): void {
    logger.main.info("Onboarding try-it active changed", { active });
    this.emit("try-it-active-changed", active);
  }

  /**
   * Cancel the onboarding flow
   * Emits "cancelled" event - AppManager handles window close and app quit
   */
  async cancelOnboardingFlow(): Promise<void> {
    logger.main.info("Onboarding cancelled");

    this.isOnboardingInProgress = false;

    // Track abandonment event
    const currentState = await this.getOnboardingState();
    const lastScreen =
      currentState?.lastVisitedScreen ||
      currentState?.skippedScreens?.[currentState.skippedScreens.length - 1] ||
      "unknown";
    this.trackOnboardingAbandoned(lastScreen);

    // Emit event - AppManager listens and handles window close + app quit
    this.emit("cancelled");

    logger.main.info("Onboarding cancelled, emitted event");
  }
}
