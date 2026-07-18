import { app } from "electron";
import { EventEmitter } from "events";
import { logger } from "../main/logger";
import { Effect, Layer, Scope } from "effect";
import {
  TelemetryServiceTag,
  PostHogClientTag,
  SettingsServiceTag,
  ServiceLocatorTag,
  AuthServiceTag,
  AppScopeTag,
} from "../main/runtime/tags";
import { step, up } from "../main/runtime/layer-helpers";
import type { SettingsService } from "./settings-service";
import type { PostHogClient, SystemInfo } from "./posthog-client";
import type { AuthState } from "./auth-service";
import type {
  OnboardingStartedEvent,
  OnboardingScreenViewedEvent,
  OnboardingStepResultEvent,
  OnboardingFeaturesSelectedEvent,
  OnboardingDiscoverySelectedEvent,
  OnboardingModelSelectedEvent,
  OnboardingCompletedEvent,
  OnboardingAbandonedEvent,
  NativeHelperCrashedEvent,
  NoteCreatedEvent,
  TranscriptionReportedEvent,
  WidgetNotificationShownEvent,
  CloudGrpcFallbackEvent,
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
  is_retry?: boolean;
  languages?: string[]; // Selected dictation languages; [] = auto-detect
  vocabulary_size?: number;
}

/**
 * Emits "identity-changed" after identifyUser()/resetUser() so downstream
 * identity consumers (feature flags) can react without auth or telemetry
 * knowing about them.
 */
export class TelemetryService extends EventEmitter {
  private client: PostHogClient;
  private enabled: boolean = false;
  private initialized: boolean = false;
  private persistedProperties: Record<string, unknown> = {};
  private settingsService: SettingsService;

  // Construction goes through Live: the graph is the only thing that may
  // build this service, which also makes single-construction structural.
  private constructor(client: PostHogClient, settingsService: SettingsService) {
    super();
    this.client = client;
    this.settingsService = settingsService;
  }

  /**
   * The service's layer. Registers the early ref (the facade's nullable
   * accessor serves crash telemetry mid-build) and subscribes to the auth
   * events that drive identity: identify on "authenticated" (when the token
   * carried a subject), reset on "logged-out" (only if identified — the
   * reset gate keeps "identity-changed" meaning an ACTUAL change). The
   * subscriptions are removed when the app scope closes: the auth instance
   * is a process-wide static that outlives the graph. Composed into AppLive
   * by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<
    TelemetryServiceTag,
    never,
    | PostHogClientTag
    | SettingsServiceTag
    | ServiceLocatorTag
    | AuthServiceTag
    | AppScopeTag
  > = Layer.effect(
    TelemetryServiceTag,
    Effect.gen(function* () {
      const locator = yield* ServiceLocatorTag;
      const client = yield* PostHogClientTag;
      const settingsService = yield* SettingsServiceTag;
      const authService = yield* AuthServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new TelemetryService(client, settingsService);
      yield* Effect.sync(() =>
        locator.registerEarlyService("telemetryService", service),
      );
      yield* step(() => service.initialize());
      const onAuthenticated = (authState: AuthState) => {
        if (!authState.userInfo?.sub) return;
        service.identifyUser(
          authState.userInfo.sub,
          authState.userInfo.email,
          authState.userInfo.name,
        );
      };
      const onLoggedOut = () => {
        if (!service.isUserIdentified()) return;
        service.resetUser();
      };
      authService.on("authenticated", onAuthenticated);
      authService.on("logged-out", onLoggedOut);
      yield* Scope.addFinalizer(
        appScope,
        Effect.sync(() => {
          authService.off("authenticated", onAuthenticated);
          authService.off("logged-out", onLoggedOut);
        }),
      );
      logger.main.info("Telemetry service initialized");
      up("telemetryService");
      return service;
    }),
  );

  /**
   * Test-only escape hatch: a raw, UNINITIALIZED instance for unit tests
   * that drive initialize() with fakes directly. Production construction
   * goes through Live.
   */
  static createForTests(
    client: PostHogClient,
    settingsService: SettingsService,
  ): TelemetryService {
    return new TelemetryService(client, settingsService);
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.client.posthog) {
      return;
    }

    // Sync opt-out state with database settings
    const telemetrySettings = await this.settingsService.getTelemetrySettings();
    const userTelemetryEnabled = telemetrySettings.enabled !== false;

    if (telemetrySettings.enabled === false) {
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

    const authState = (await this.settingsService.getAllSettings()).auth;
    if (authState?.isAuthenticated && authState.userInfo?.sub) {
      this.client.setIdentifiedUser(
        authState.userInfo.sub,
        authState.userInfo.email,
        authState.userInfo.name,
      );
    }

    this.enabled = userTelemetryEnabled;
    this.initialized = true;

    this.sendIdentifyForCurrentUser();

    logger.main.info("Telemetry service initialized successfully", {
      enabled: this.enabled,
    });
  }

  trackTranscriptionCompleted(metrics: TranscriptionMetrics): void {
    this.captureEvent("transcription_completed", metrics);

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
    const distinctId = this.client.distinctId;
    if (!this.client.posthog || !this.enabled || !distinctId) {
      return;
    }

    this.client.posthog.captureException(
      error,
      distinctId,
      this.buildEventProperties(additionalProperties),
    );
  }

  async captureExceptionImmediateAndShutdown(
    error: unknown,
    additionalProperties: Record<string, unknown> = {},
  ): Promise<void> {
    const distinctId = this.client.distinctId;
    if (!this.client.posthog || !this.enabled || !distinctId) {
      return;
    }

    // posthog-node's captureExceptionImmediate schedules async work but doesn't await network flush.
    // For fatal flows where we call this method, ensure events are sent before continuing by shutting down.
    this.client.posthog.captureExceptionImmediate(
      error,
      distinctId,
      this.buildEventProperties(additionalProperties),
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
    if (!this.client.posthog) {
      this.enabled = true;
      return;
    }

    await this.client.posthog.optIn();
    this.enabled = true;
    this.sendIdentifyForCurrentUser();

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
   * The machine ID remains the anonymous ID and is linked via $anon_distinct_id.
   */
  identifyUser(userId: string, email?: string, name?: string): void {
    this.client.setIdentifiedUser(userId, email, name);
    this.sendIdentifyForCurrentUser();
    this.emit("identity-changed");
  }

  /**
   * Return future telemetry to the anonymous machine ID after logout.
   */
  resetUser(): void {
    this.client.clearIdentifiedUser();
    this.emit("identity-changed");
  }

  isUserIdentified(): boolean {
    return this.client.isIdentified;
  }

  private sendIdentifyForCurrentUser(): void {
    const user = this.client.identifiedUser;
    if (!this.client.posthog || !this.enabled || !user) return;

    this.client.posthog.identify({
      distinctId: user.userId,
      properties: {
        ...this.persistedProperties,
        ...(user.email && { email: user.email }),
        ...(user.name && { name: user.name }),
        ...(this.client.machineId && {
          $anon_distinct_id: this.client.machineId,
        }),
      },
    });
  }

  private buildEventProperties(
    properties: object = {},
  ): Record<string, unknown> {
    return {
      ...properties,
      // Stable app and identity context should not be overridden by event callers.
      ...this.persistedProperties,
      ...this.client.eventIdentityProperties,
    };
  }

  private captureEvent(event: string, properties: object = {}): void {
    const distinctId = this.client.distinctId;
    if (!this.client.posthog || !this.enabled || !distinctId) return;

    this.client.posthog.capture({
      distinctId,
      event,
      properties: this.buildEventProperties(properties),
    });
  }

  trackAppLaunch(): void {
    this.captureEvent("app_launch");

    logger.main.debug("Tracked app launch");
  }

  // ============================================================================
  // Onboarding Events
  // ============================================================================

  trackOnboardingStarted(props: OnboardingStartedEvent): void {
    this.captureEvent("onboarding_started", props);

    logger.main.debug("Tracked onboarding started", props);
  }

  trackOnboardingScreenViewed(props: OnboardingScreenViewedEvent): void {
    this.captureEvent("onboarding_screen_viewed", props);

    logger.main.debug("Tracked onboarding screen viewed", props);
  }

  trackOnboardingFeaturesSelected(
    props: OnboardingFeaturesSelectedEvent,
  ): void {
    this.captureEvent("onboarding_features_selected", props);

    logger.main.debug("Tracked onboarding features selected", props);
  }

  trackOnboardingDiscoverySelected(
    props: OnboardingDiscoverySelectedEvent,
  ): void {
    this.captureEvent("onboarding_discovery_selected", props);

    logger.main.debug("Tracked onboarding discovery selected", props);
  }

  trackOnboardingModelSelected(props: OnboardingModelSelectedEvent): void {
    this.captureEvent("onboarding_model_selected", props);

    logger.main.debug("Tracked onboarding model selected", props);
  }

  trackOnboardingCompleted(props: OnboardingCompletedEvent): void {
    this.captureEvent("onboarding_completed", props);

    logger.main.debug("Tracked onboarding completed", props);
  }

  trackOnboardingAbandoned(props: OnboardingAbandonedEvent): void {
    this.captureEvent("onboarding_abandoned", props);

    logger.main.debug("Tracked onboarding abandoned", props);
  }

  trackOnboardingStepResult(props: OnboardingStepResultEvent): void {
    this.captureEvent("onboarding_step_result", props);

    logger.main.debug("Tracked onboarding step result", props);
  }

  // ============================================================================
  // Native Helper Events
  // ============================================================================

  trackNativeHelperCrashed(props: NativeHelperCrashedEvent): void {
    this.captureEvent("native_helper_crashed", props);

    logger.main.debug("Tracked native helper crash", props);
  }

  // ============================================================================
  // Notes Events
  // ============================================================================

  trackNoteCreated(props: NoteCreatedEvent): void {
    this.captureEvent("note_created", props);

    logger.main.debug("Tracked note created", props);
  }

  // ============================================================================
  // Transcription Events
  // ============================================================================

  trackTranscriptionReported(props: TranscriptionReportedEvent): void {
    this.captureEvent("transcription_reported", props);

    logger.main.debug("Tracked transcription reported", props);
  }

  trackCloudGrpcFallback(props: CloudGrpcFallbackEvent): void {
    this.captureEvent("cloud_grpc_fallback", props);

    logger.main.debug("Tracked cloud gRPC fallback", props);
  }

  // ============================================================================
  // Widget Notification Events
  // ============================================================================

  trackWidgetNotificationShown(props: WidgetNotificationShownEvent): void {
    this.captureEvent("widget_notification_shown", props);

    logger.main.debug("Tracked widget notification shown", props);
  }

  /**
   * Get system information for model recommendations
   */
  getSystemInfo(): SystemInfo | null {
    return this.client.systemInfo;
  }
}
