import { Cause, Context, Exit } from "effect";
import type { Scope } from "effect";

import { logger } from "../logger";
import { buildAppServices, closeAppScope } from "../runtime/app-runtime";
import { ServicesBundleTag } from "../runtime/tags";

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
 * Early service refs — the record is injected into the graph (EarlyRefsTag)
 * and the Settings/Telemetry/Onboarding acquires write themselves in the
 * moment each instance exists, so the nullable accessors can serve the
 * crash path mid-build.
 */
export interface EarlyServiceRefs {
  settingsService?: SettingsService;
  telemetryService?: TelemetryService;
  onboardingService?: OnboardingService;
}

// historyCleanupService has a layer but no ServiceMap entry —
// lifecycle-only, unreachable via services(), exactly as in the old
// container.

/**
 * The boot handle: initialize() builds the Effect layer graph
 * (src/main/runtime/) into an app-owned scope, cleanup() closes the scope
 * running the registered finalizers dependents-first, and the early-ref
 * accessors serve the crash path. Services get their dependencies from the
 * graph, not from here.
 *
 * services() returns the graph's frozen bundle (ServicesBundleTag), read
 * off the built context at the end of initialize(). Its one production
 * caller is AppManager's post-build resolve — the tRPC context gets the
 * SAME bundle in-graph through the handler layer, not through here. Do
 * not add new callers; take the dependency in your Live layer instead.
 * Behavior is unchanged from the hand-rolled container this replaced,
 * including:
 * - services() throwing "ServiceManager not initialized..." until the FULL
 *   graph has built (the pre-ready throw window the test harness pins);
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
  private resolvedServices: Readonly<ServiceMap> | null = null;
  private earlyRefs: EarlyServiceRefs = {};

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.main.warn(
        "ServiceManager is already initialized, skipping initialization",
      );
      return;
    }

    const { scope, exit } = await buildAppServices(this.earlyRefs);
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

    // The graph's own summary node — assigned only after the FULL graph
    // builds, preserving the pre-ready throw window of services().
    this.resolvedServices = Context.get(exit.value, ServicesBundleTag);
    this.isInitialized = true;
    logger.main.info("Services initialized successfully");
  }

  getLogger() {
    return logger;
  }

  /**
   * The resolved service bundle. Throws until the FULL graph has built;
   * never a partial map (windows, and thus tRPC requests, exist only
   * post-build).
   */
  services(): Readonly<ServiceMap> {
    if (!this.resolvedServices) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    return this.resolvedServices;
  }

  async cleanup(): Promise<void> {
    // Idempotence latch: pre-init or double cleanup is a no-op.
    if (!this.scope) {
      return;
    }
    const scope = this.scope;
    this.scope = null;
    // resolvedServices/isInitialized are intentionally NOT reset: renderer
    // tRPC calls racing teardown still read the bundle, and the old
    // cleaned-up container kept serving lookups too.
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
