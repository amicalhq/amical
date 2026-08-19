import { app } from "electron";
import { EventEmitter } from "events";
import { logger } from "../main/logger";
import { Effect, Layer, Scope } from "effect";
import {
  TelemetryServiceTag,
  PostHogClientTag,
  SettingsServiceTag,
  EarlyRefsTag,
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
  total_duration_ms?: number;
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

/** Client-side flood guard: posthog-node rate-limits only AUTOCAPTURED
 * exceptions, so manual capture()/captureException() — e.g. an error loop —
 * can flood PostHog unguarded. Token buckets: a full burst up front, then
 * one token per refill interval, keyed per event name / per exception
 * fingerprint. */
const EVENT_RATE_LIMIT = { bucketSize: 10, refillIntervalMs: 10_000 };
const EXCEPTION_RATE_LIMIT = { bucketSize: 5, refillIntervalMs: 60_000 };
/** Second layer across ALL exceptions: catches floods whose fingerprint
 * churns (unique messages without a stack, unique non-Error values), which
 * the per-fingerprint buckets cannot see. Checked only after the
 * per-fingerprint bucket allows, so a same-key storm cannot drain it. */
const EXCEPTION_GLOBAL_RATE_LIMIT = { bucketSize: 20, refillIntervalMs: 10_000 };
const EXCEPTION_GLOBAL_KEY = "exceptions-global";
const RATE_BUCKET_MAX_KEYS = 500;

interface RateBucket {
  tokens: number;
  size: number;
  refillIntervalMs: number;
  lastRefill: number;
  dropped: number;
}

/** Keyed by throw site (name + top frame) so a loop rethrowing the same
 * error stays one key even when the message churns. Must never throw into
 * the caller's error path: hostile values (throwing toString/getters) fall
 * back to one shared key. */
function exceptionFingerprint(error: unknown): string {
  try {
    if (error instanceof Error) {
      const topFrame = error.stack
        ?.split("\n")
        .find((line) => line.trimStart().startsWith("at "))
        ?.trim();
      return `${error.name}:${topFrame ?? error.message.slice(0, 100)}`;
    }
    return String(error).slice(0, 100);
  } catch {
    return "unfingerprintable";
  }
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
  private rateBuckets = new Map<string, RateBucket>();

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
   * subscriptions are removed when the app scope closes, so a torn-down
   * graph's consumers stop reacting to late auth events and repeated builds
   * in one process (tests) can't accumulate listeners. Composed into AppLive
   * by src/main/runtime/layers.ts.
   */
  static readonly Live: Layer.Layer<
    TelemetryServiceTag,
    never,
    | PostHogClientTag
    | SettingsServiceTag
    | EarlyRefsTag
    | AuthServiceTag
    | AppScopeTag
  > = Layer.effect(
    TelemetryServiceTag,
    Effect.gen(function* () {
      const earlyRefs = yield* EarlyRefsTag;
      const client = yield* PostHogClientTag;
      const settingsService = yield* SettingsServiceTag;
      const authService = yield* AuthServiceTag;
      const appScope = yield* AppScopeTag;
      const service = new TelemetryService(client, settingsService);
      yield* Effect.sync(() => {
        earlyRefs.telemetryService = service;
      });
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

  /** The per-session dictation trace, flushed once per session on every
   * disposition (phase durations, offsets, failure stage). This IS the
   * transcription_completed_v2 event for live dictations. */
  trackDictationTrace(properties: Record<string, unknown>): void {
    this.captureEvent("transcription_completed_v2", properties);
  }

  /** History-retry path only — live dictations report through the dictation
   * trace above. Discriminated by is_retry. */
  trackTranscriptionCompleted(metrics: TranscriptionMetrics): void {
    this.captureEvent("transcription_completed", metrics);

    logger.main.debug("Tracked transcription completion", {
      session_id: metrics.session_id,
      model: metrics.model_id,
      duration: metrics.total_duration_ms,
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
    if (
      !this.allowCapture(
        `exception:${exceptionFingerprint(error)}`,
        EXCEPTION_RATE_LIMIT,
        true,
      ) ||
      !this.allowCapture(EXCEPTION_GLOBAL_KEY, EXCEPTION_GLOBAL_RATE_LIMIT)
    ) {
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
    // Deliberately exempt from the rate limiter: the shutdown below makes
    // this path self-limiting, and a fatal report must not be dropped
    // because earlier noise drained the buckets.
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

  /** Returns false when the key is over its rate limit and the capture must
   * be dropped. Logs once when a key starts dropping and reports the count
   * when it recovers. Capped keys (exception fingerprints, open-ended) fail
   * closed while the bucket map is full, so a unique-key flood can grow
   * neither the map nor the sweep work; fixed keys (event names, the global
   * bucket) always get a bucket. */
  private allowCapture(
    key: string,
    limit: { bucketSize: number; refillIntervalMs: number },
    capped = false,
  ): boolean {
    const now = Date.now();
    let bucket = this.rateBuckets.get(key);
    if (!bucket) {
      if (capped && this.rateBuckets.size >= RATE_BUCKET_MAX_KEYS) {
        // Evict idle buckets before adding a key. Stored token counts are
        // stale (refill happens on access), so credit the elapsed refill
        // when judging idleness. A map still full after eviction fails
        // closed — mid-flood the global bucket would gate the send anyway.
        for (const [staleKey, stale] of this.rateBuckets) {
          const idleTokens =
            stale.tokens +
            Math.floor((now - stale.lastRefill) / stale.refillIntervalMs);
          if (idleTokens >= stale.size) this.rateBuckets.delete(staleKey);
        }
        if (this.rateBuckets.size >= RATE_BUCKET_MAX_KEYS) return false;
      }
      bucket = {
        tokens: limit.bucketSize,
        size: limit.bucketSize,
        refillIntervalMs: limit.refillIntervalMs,
        lastRefill: now,
        dropped: 0,
      };
      this.rateBuckets.set(key, bucket);
    } else {
      const intervals = Math.floor(
        (now - bucket.lastRefill) / bucket.refillIntervalMs,
      );
      if (intervals > 0) {
        bucket.tokens = Math.min(bucket.tokens + intervals, bucket.size);
        bucket.lastRefill += intervals * bucket.refillIntervalMs;
      }
    }

    if (bucket.tokens === 0) {
      bucket.dropped += 1;
      if (bucket.dropped === 1) {
        logger.main.warn("Telemetry rate limit engaged; dropping", { key });
      }
      return false;
    }
    bucket.tokens -= 1;
    if (bucket.dropped > 0) {
      logger.main.info("Telemetry rate limit recovered", {
        key,
        dropped: bucket.dropped,
      });
      bucket.dropped = 0;
    }
    return true;
  }

  private captureEvent(event: string, properties: object = {}): void {
    const distinctId = this.client.distinctId;
    if (!this.client.posthog || !this.enabled || !distinctId) return;
    if (!this.allowCapture(`event:${event}`, EVENT_RATE_LIMIT)) return;

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
