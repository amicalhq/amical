import { Cause, Context, Exit } from "effect";
import type { Scope } from "effect";

import { logger } from "../logger";
import { buildAppServices, closeAppScope } from "../runtime/app-runtime";
import {
  SettingsServiceTag,
  AuthServiceTag,
  PostHogClientTag,
  TelemetryServiceTag,
  FeatureFlagServiceTag,
  RemoteConfigServiceTag,
  ModelServiceTag,
  OnboardingServiceTag,
  NativeBridgeTag,
  VadServiceTag,
  TranscriptionServiceTag,
  RecordingManagerTag,
  ShortcutManagerTag,
  AutoUpdaterServiceTag,
  WindowManagerTag,
  type AppServices,
} from "../runtime/tags";

import type { ModelService } from "../../services/model-service";
import type { TranscriptionService } from "../../services/transcription-service";
import type { SettingsService } from "../../services/settings-service";
import type { NativeBridge } from "../../services/platform/native-bridge-service";
import type { AutoUpdaterService } from "../services/auto-updater";
import type { RecordingManager } from "./recording-manager";
import type { VADService } from "../../services/vad-service";
import type { ShortcutManager } from "./shortcut-manager";
import type { WindowManager } from "../core/window-manager";
import type { PostHogClient } from "../../services/posthog-client";
import type { TelemetryService } from "../../services/telemetry-service";
import type { AuthService } from "../../services/auth-service";
import type { OnboardingService } from "../../services/onboarding-service";
import type { FeatureFlagService } from "../../services/feature-flag-service";
import type { RemoteConfigService } from "../../services/remote-config-service";

/**
 * Service map for type-safe service access
 */
export interface ServiceMap {
  posthogClient: PostHogClient;
  telemetryService: TelemetryService;
  featureFlagService: FeatureFlagService;
  remoteConfigService: RemoteConfigService;
  modelService: ModelService;
  // Honest nullability: transcription's init failure is non-fatal (the tag
  // holds null so dictation can fail cleanly while the rest of the app
  // works), and the bridge only exists on macOS/Windows.
  transcriptionService: TranscriptionService | null;
  settingsService: SettingsService;
  authService: AuthService;
  vadService: VADService;
  nativeBridge: NativeBridge | null;
  autoUpdaterService: AutoUpdaterService;
  recordingManager: RecordingManager;
  shortcutManager: ShortcutManager;
  windowManager: WindowManager;
  onboardingService: OnboardingService;
}

/**
 * Early service refs — registered by the layer graph's Settings/Telemetry/
 * Onboarding acquires (src/main/runtime/layers.ts) the moment each instance
 * exists, so the nullable accessors can serve the crash path mid-build.
 */
export interface EarlyServiceRefs {
  settingsService?: SettingsService;
  telemetryService?: TelemetryService;
  onboardingService?: OnboardingService;
}

// ServiceMap keys backed by the layer graph. historyCleanupService has a
// layer but no ServiceMap entry — lifecycle-only, unreachable via
// getService(), exactly as in the old container.
const TAGS = {
  posthogClient: PostHogClientTag,
  telemetryService: TelemetryServiceTag,
  featureFlagService: FeatureFlagServiceTag,
  remoteConfigService: RemoteConfigServiceTag,
  modelService: ModelServiceTag,
  transcriptionService: TranscriptionServiceTag,
  settingsService: SettingsServiceTag,
  authService: AuthServiceTag,
  vadService: VadServiceTag,
  nativeBridge: NativeBridgeTag,
  autoUpdaterService: AutoUpdaterServiceTag,
  recordingManager: RecordingManagerTag,
  shortcutManager: ShortcutManagerTag,
  windowManager: WindowManagerTag,
  onboardingService: OnboardingServiceTag,
} as const satisfies Record<keyof ServiceMap, unknown>;

/**
 * The boot handle: initialize() builds the Effect layer graph
 * (src/main/runtime/) into an app-owned scope, cleanup() closes the scope
 * running the registered finalizers dependents-first, and the early-ref
 * accessors serve the crash path. Services get their dependencies from the
 * graph, not from here.
 *
 * getService() is a synchronous Context lookup with exactly two callers —
 * the tRPC context's lazy getters (src/trpc/context.ts) and AppManager's
 * one-time post-build resolve. Do not add new ones; take the dependency in
 * your Live layer instead. Behavior is unchanged from the hand-rolled
 * container this replaced, including:
 * - getService() throwing "ServiceManager not initialized..." until the FULL
 *   graph has built (the lazy tRPC context's failed-init tolerance relies on
 *   the throw);
 * - a failed initialize() leaving the partial graph ALIVE (no rollback) so
 *   app.ts's crash path can read getTelemetryService() and flush PostHog,
 *   with the ORIGINAL Error (never a FiberFailure) rethrown to the dialog;
 * - cleanup() staying safe and idempotent on a never-initialized or
 *   half-built container.
 */
// Not a singleton: app.ts constructs the one production instance and hands
// it to AppManager; tests construct their own.
export class ServiceManager {
  private isInitialized = false;

  private scope: Scope.CloseableScope | null = null;
  private context: Context.Context<AppServices> | null = null;
  private earlyRefs: EarlyServiceRefs = {};

  registerEarlyService<K extends keyof EarlyServiceRefs>(
    name: K,
    service: NonNullable<EarlyServiceRefs[K]>,
  ): void {
    this.earlyRefs[name] = service;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.main.warn(
        "ServiceManager is already initialized, skipping initialization",
      );
      return;
    }

    const { scope, exit } = await buildAppServices(this);
    // The scope is held even on failure: the partial graph stays alive for
    // the crash path, and cleanup() releases it.
    this.scope = scope;

    if (Exit.isFailure(exit)) {
      logger.main.error(
        "Service graph build failed:\n" + Cause.pretty(exit.cause),
      );
      // Cause.squash hands back the ORIGINAL Error thrown by a service init,
      // so app.ts's dialog text and instanceof checks are unchanged.
      throw Cause.squash(exit.cause);
    }

    this.context = exit.value;
    // Flips only after the FULL graph builds — preserving the pre-ready
    // throw window the lazy tRPC context depends on.
    this.isInitialized = true;
    logger.main.info("Services initialized successfully");
  }

  getLogger() {
    return logger;
  }

  getService<K extends keyof ServiceMap>(serviceName: K): ServiceMap[K] {
    if (!this.isInitialized || !this.context) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }

    const tag = TAGS[serviceName];
    // Correlation cast only: TS can't relate TAGS[K]'s tag to ServiceMap[K]
    // across the generic; the value types match key-for-key (including the
    // honest `| null` on transcriptionService/nativeBridge).
    return Context.get(this.context, tag as never) as ServiceMap[K];
  }

  async cleanup(): Promise<void> {
    // Idempotence latch: pre-init or double cleanup is a no-op.
    if (!this.scope) {
      return;
    }
    const scope = this.scope;
    this.scope = null;
    // context/isInitialized are intentionally NOT reset: renderer tRPC calls
    // racing teardown still resolve through the lazy context getters, and
    // the old cleaned-up container kept serving getService too.
    await closeAppScope(scope);
  }

  getOnboardingService(): OnboardingService | null {
    return this.earlyRefs.onboardingService ?? null;
  }

  getSettingsService(): SettingsService | null {
    return this.earlyRefs.settingsService ?? null;
  }

  getTelemetryService(): TelemetryService | null {
    return this.earlyRefs.telemetryService ?? null;
  }
}
