/**
 * Effect Context.Service definitions for the app service graph (AMIC-42).
 *
 * This module is type-only with respect to the services: every service class
 * import MUST be `import type` so this file has zero runtime dependencies on
 * service modules and cannot join the pre-existing service-manager ↔
 * auth-service import cycle. The only value import is `effect` itself.
 *
 * Nullability is honest at the tag level where reality is nullable:
 * - NativeBridgeTag is `NativeBridge | null` — the bridge only exists on
 *   macOS/Windows (service-manager platform gate).
 * - TranscriptionServiceTag is `TranscriptionService | null` — its init
 *   failure is swallowed (non-fatal) and the container holds null.
 * VADService stays non-null: its constructor is empty and initialize() never
 * rejects (it degrades internally); the null branch in the old container was
 * dead code.
 *
 * WindowManager and the tRPC handler are graph services (knot 1 of the
 * de-facade program): construction lives in the graph; window-CREATION
 * policy (onboarding vs main window) stays imperative in AppManager after
 * the build, so window timing is unchanged.
 */

import { Context } from "effect";
import type { Scope } from "effect";

import type { SettingsService } from "../../services/settings-service";
import type { SettingsSyncService } from "../../services/settings-sync-service";
import type { ActivityReportingService } from "../../services/activity-reporting-service";
import type { AuthService } from "../../services/auth-service";
import type { PostHogClient } from "../../services/posthog-client";
import type { TelemetryService } from "../../services/telemetry-service";
import type { FeatureFlagService } from "../../services/feature-flag-service";
import type { RemoteConfigService } from "../../services/remote-config-service";
import type { HistoryCleanupService } from "../../services/history-cleanup-service";
import type { ModelService } from "../../services/model-service";
import type { OnboardingService } from "../../services/onboarding-service";
import type { NativeBridge } from "../../services/platform/native-bridge-service";
import type { VADService } from "../../services/vad-service";
import type { TranscriptionService } from "../../services/transcription-service";
import type { DesktopRecordingLifecycle } from "../lifecycle/live";
import type { ShortcutManager } from "../managers/shortcut-manager";
import type { AutoUpdaterService } from "../services/auto-updater";
import type { ServiceMap, EarlyServiceRefs } from "../managers/service-manager";
import type { WindowManager } from "../core/window-manager";
import type { createIPCHandler } from "electron-trpc-experimental/main";

export class SettingsServiceTag extends Context.Service<
  SettingsServiceTag,
  SettingsService
>()("AmicalApp/SettingsService") {}

export class HistoryCleanupServiceTag extends Context.Service<
  HistoryCleanupServiceTag,
  HistoryCleanupService
>()("AmicalApp/HistoryCleanupService") {}

export class AuthServiceTag extends Context.Service<
  AuthServiceTag,
  AuthService
>()("AmicalApp/AuthService") {}

export class SettingsSyncServiceTag extends Context.Service<
  SettingsSyncServiceTag,
  SettingsSyncService
>()("AmicalApp/SettingsSyncService") {}

export class ActivityReportingServiceTag extends Context.Service<
  ActivityReportingServiceTag,
  ActivityReportingService
>()("AmicalApp/ActivityReportingService") {}

export class PostHogClientTag extends Context.Service<
  PostHogClientTag,
  PostHogClient
>()("AmicalApp/PostHogClient") {}

export class TelemetryServiceTag extends Context.Service<
  TelemetryServiceTag,
  TelemetryService
>()("AmicalApp/TelemetryService") {}

export class FeatureFlagServiceTag extends Context.Service<
  FeatureFlagServiceTag,
  FeatureFlagService
>()("AmicalApp/FeatureFlagService") {}

export class RemoteConfigServiceTag extends Context.Service<
  RemoteConfigServiceTag,
  RemoteConfigService
>()("AmicalApp/RemoteConfigService") {}

export class ModelServiceTag extends Context.Service<
  ModelServiceTag,
  ModelService
>()("AmicalApp/ModelService") {}

export class OnboardingServiceTag extends Context.Service<
  OnboardingServiceTag,
  OnboardingService
>()("AmicalApp/OnboardingService") {}

export class NativeBridgeTag extends Context.Service<
  NativeBridgeTag,
  NativeBridge | null
>()("AmicalApp/NativeBridge") {}

export class VadServiceTag extends Context.Service<VadServiceTag, VADService>()(
  "AmicalApp/VADService",
) {}

export class TranscriptionServiceTag extends Context.Service<
  TranscriptionServiceTag,
  TranscriptionService | null
>()("AmicalApp/TranscriptionService") {}

export class RecordingLifecycleTag extends Context.Service<
  RecordingLifecycleTag,
  DesktopRecordingLifecycle
>()("AmicalApp/RecordingLifecycle") {}

export class ShortcutManagerTag extends Context.Service<
  ShortcutManagerTag,
  ShortcutManager
>()("AmicalApp/ShortcutManager") {}

export class AutoUpdaterServiceTag extends Context.Service<
  AutoUpdaterServiceTag,
  AutoUpdaterService
>()("AmicalApp/AutoUpdaterService") {}

export class TrpcHandlerTag extends Context.Service<
  TrpcHandlerTag,
  ReturnType<typeof createIPCHandler>
>()("AmicalApp/TrpcHandler") {}

export class WindowManagerTag extends Context.Service<
  WindowManagerTag,
  WindowManager
>()("AmicalApp/WindowManager") {}

/**
 * The graph's summary node: the frozen bundle of every ServiceMap service,
 * produced by ServicesBundleLive at the END of the graph. Depending on it
 * makes "sees a complete graph" a structural guarantee — the tRPC handler
 * can't exist without every service, and the boot handle's services() reads
 * this same object.
 */
export class ServicesBundleTag extends Context.Service<
  ServicesBundleTag,
  Readonly<ServiceMap>
>()("AmicalApp/ServicesBundle") {}

/**
 * The crash path's early-ref record, injected at build time (build plumbing
 * like AppScopeTag — NOT part of AppServices). The Settings/Telemetry/
 * Onboarding acquires write themselves in the moment each instance exists,
 * so the boot handle's nullable accessors can serve a failed boot. This is
 * the graph's ONLY write-side channel — there is deliberately no locator to
 * read arbitrary services through.
 */
export class EarlyRefsTag extends Context.Service<
  EarlyRefsTag,
  EarlyServiceRefs
>()("AmicalApp/EarlyRefs") {}

/**
 * The app-owned Scope.Closeable that service finalizers are registered on,
 * injected at build time. Deliberately NOT part of AppServices: it is build
 * plumbing, not a service. Finalizers must go on this scope (via
 * Scope.addFinalizer) instead of Effect.acquireRelease inside a layer,
 * because Layer.build is transactional: a partial build
 * failure closes each layer's inner scope and would roll back every
 * already-acquired service — the old container kept them alive for the
 * crash path (verified empirically; see app-runtime.ts).
 */
export class AppScopeTag extends Context.Service<
  AppScopeTag,
  Scope.Closeable
>()("AmicalApp/AppScope") {}

/** Union of every tag in the app graph — the Context the runtime builds. */
export type AppServices =
  | SettingsServiceTag
  | HistoryCleanupServiceTag
  | AuthServiceTag
  | SettingsSyncServiceTag
  | ActivityReportingServiceTag
  | PostHogClientTag
  | TelemetryServiceTag
  | FeatureFlagServiceTag
  | RemoteConfigServiceTag
  | ModelServiceTag
  | OnboardingServiceTag
  | NativeBridgeTag
  | VadServiceTag
  | TranscriptionServiceTag
  | RecordingLifecycleTag
  | ShortcutManagerTag
  | AutoUpdaterServiceTag
  | TrpcHandlerTag
  | WindowManagerTag
  | ServicesBundleTag;
