import { app } from "electron";
import { logger } from "../main/logger";
import type { SettingsService } from "./settings-service";
import type { PostHogClient, SystemInfo } from "./posthog-client";
import type {
  OnboardingStartedEvent,
  OnboardingScreenViewedEvent,
  OnboardingFeaturesSelectedEvent,
  OnboardingDiscoverySelectedEvent,
  OnboardingModelSelectedEvent,
  OnboardingCompletedEvent,
  OnboardingAbandonedEvent,
  NativeHelperCrashedEvent,
  NoteCreatedEvent,
} from "../types/telemetry-events";

// Re-export from posthog-client for backwards compatibility
export type { SystemInfo } from "./posthog-client";

export interface TranscriptionMetrics {
  session_id?: string;
  model_id: string;
  model_preloaded?: boolean;
  whisper_native_binding?: string;
  total_duration_ms?: number;
  recording_duration_ms?: number;
  processing_duration_ms?: number;
  audio_duration_seconds?: number;
  realtime_factor?: number;
  text_length?: number;
  word_count?: number;
  formatting_enabled?: boolean;
  formatting_model?: string;
  formatting_duration_ms?: number;
  vad_enabled?: boolean;
  session_type?: "streaming" | "batch";
  language?: string;
  vocabulary_size?: number;
}

export class TelemetryService {
  private client: PostHogClient;
  private enabled: boolean = false;
  private initialized: boolean = false;
  private persistedProperties: Record<string, unknown> = {};
  private settingsService: SettingsService;

  constructor(client: PostHogClient, settingsService: SettingsService) {
    this.client = client;
    this.settingsService = settingsService;
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.client.posthog) {
      return;
    }

    // Sync opt-out state with database settings
    const telemetrySettings = await this.settingsService.getTelemetrySettings();
    const userTelemetryEnabled = telemetrySettings?.enabled !== false;

    if (telemetrySettings?.enabled === false) {
      await this.client.posthog.optOut();
      logger.main.debug("Opted out of telemetry");
    } else {
      await this.client.posthog.optIn();
      logger.main.debug("Opted into telemetry");
    }

    // ! posthog-node code flow doesn't use register to set super properties
    // ! Track them manually
    this.persistedProperties = {
      app_version: app.getVersion(),
      machine_id: this.client.machineId,
      app_is_packaged: app.isPackaged,
      system_info: {
        ...this.client.systemInfo,
      },
    };

    this.enabled = userTelemetryEnabled;
    this.initialized = true;
    logger.main.info("Telemetry service initialized successfully", {
      enabled: this.enabled,
    });
  }

  trackTranscriptionCompleted(metrics: TranscriptionMetrics): void {
    if (!this.client.posthog || !this.enabled) {
      return;
    }

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "transcription_completed",
      properties: {
        ...metrics,
        ...this.persistedProperties,
      },
    });

    logger.main.debug("Tracked transcription completion", {
      session_id: metrics.session_id,
      model: metrics.model_id,
      duration: metrics.total_duration_ms,
      recording_duration: metrics.recording_duration_ms,
      processing_duration: metrics.processing_duration_ms,
    });
  }

  captureException(
    error: unknown,
    additionalProperties: Record<string, unknown> = {},
  ): void {
    if (!this.client.posthog || !this.enabled) {
      return;
    }

    this.client.posthog.captureException(
      error,
      this.client.machineId || undefined,
      {
        ...this.persistedProperties,
        ...additionalProperties,
      },
    );
  }

  async captureExceptionImmediateAndShutdown(
    error: unknown,
    additionalProperties: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.client.posthog || !this.enabled) {
      return;
    }

    // posthog-node's captureExceptionImmediate schedules async work but doesn't await network flush.
    // For fatal flows where we call this method, ensure events are sent before continuing by shutting down.
    this.client.posthog.captureExceptionImmediate(
      error,
      this.client.machineId || undefined,
      {
        ...this.persistedProperties,
        ...additionalProperties,
      },
    );

    await this.client.shutdown(5000);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMachineId(): string {
    return this.client.machineId;
  }

  async optIn(): Promise<void> {
    await this.settingsService.setTelemetrySettings({ enabled: true });
    this.enabled = true;
    if (!this.client.posthog) {
      return;
    }

    await this.client.posthog.optIn();

    logger.main.info("Telemetry opt-in successful");
  }

  async optOut(): Promise<void> {
    await this.settingsService.setTelemetrySettings({ enabled: false });
    this.enabled = false;
    if (!this.client.posthog) {
      return;
    }

    await this.client.posthog.optOut();

    logger.main.info("Telemetry opt-out successful");
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.optIn();
    } else {
      await this.optOut();
    }
  }

  // ============================================================================
  // User Identification
  // ============================================================================

  /**
   * Identify user in telemetry after login.
   * Also creates an alias to link machine ID with user ID.
   */
  identifyUser(userId: string, email?: string, name?: string): void {
    if (!this.client.posthog || !this.enabled) return;

    // Identify with user ID
    this.client.posthog.identify({
      distinctId: userId,
      properties: {
        ...this.persistedProperties,
        email,
        name,
      },
    });

    // Alias machine ID to user ID so previous anonymous events are linked
    this.client.posthog.alias({
      distinctId: userId,
      alias: this.client.machineId,
    });
  }

  trackAppLaunch(): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "app_launch",
      properties: { ...this.persistedProperties },
    });

    logger.main.debug("Tracked app launch");
  }

  // ============================================================================
  // Onboarding Events
  // ============================================================================

  trackOnboardingStarted(props: OnboardingStartedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_started",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding started", props);
  }

  trackOnboardingScreenViewed(props: OnboardingScreenViewedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_screen_viewed",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding screen viewed", props);
  }

  trackOnboardingFeaturesSelected(
    props: OnboardingFeaturesSelectedEvent,
  ): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_features_selected",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding features selected", props);
  }

  trackOnboardingDiscoverySelected(
    props: OnboardingDiscoverySelectedEvent,
  ): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_discovery_selected",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding discovery selected", props);
  }

  trackOnboardingModelSelected(props: OnboardingModelSelectedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_model_selected",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding model selected", props);
  }

  trackOnboardingCompleted(props: OnboardingCompletedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_completed",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding completed", props);
  }

  trackOnboardingAbandoned(props: OnboardingAbandonedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "onboarding_abandoned",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked onboarding abandoned", props);
  }

  // ============================================================================
  // Native Helper Events
  // ============================================================================

  trackNativeHelperCrashed(props: NativeHelperCrashedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "native_helper_crashed",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked native helper crash", props);
  }

  // ============================================================================
  // Notes Events
  // ============================================================================

  trackNoteCreated(props: NoteCreatedEvent): void {
    if (!this.client.posthog || !this.enabled) return;

    this.client.posthog.capture({
      distinctId: this.client.machineId,
      event: "note_created",
      properties: { ...props, ...this.persistedProperties },
    });

    logger.main.debug("Tracked note created", props);
  }

  // ============================================================================
  // Transcription Events
  // ============================================================================

  /**
   * Get system information for model recommendations
   */
  getSystemInfo(): SystemInfo | null {
    return this.client.systemInfo;
  }
}
