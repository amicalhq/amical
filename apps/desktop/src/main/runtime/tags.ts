/**
 * Effect Context.Tag definitions for the app service graph (AMIC-42).
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
import type { RecordingManager } from "../managers/recording-manager";
import type { ShortcutManager } from "../managers/shortcut-manager";
import type { AutoUpdaterService } from "../services/auto-updater";
import type { ServiceMap, EarlyServiceRefs } from "../managers/service-manager";
import type { WindowManager } from "../core/window-manager";
import type { createIPCHandler } from "electron-trpc-experimental/main";

export class SettingsServiceTag extends Context.Tag(
  "AmicalApp/SettingsService",
)<SettingsServiceTag, SettingsService>() {}

export class HistoryCleanupServiceTag extends Context.Tag(
  "AmicalApp/HistoryCleanupService",
)<HistoryCleanupServiceTag, HistoryCleanupService>() {}

export class AuthServiceTag extends Context.Tag("AmicalApp/AuthService")<
  AuthServiceTag,
  AuthService
>() {}

export class PostHogClientTag extends Context.Tag("AmicalApp/PostHogClient")<
  PostHogClientTag,
  PostHogClient
>() {}

export class TelemetryServiceTag extends Context.Tag(
  "AmicalApp/TelemetryService",
)<TelemetryServiceTag, TelemetryService>() {}

export class FeatureFlagServiceTag extends Context.Tag(
  "AmicalApp/FeatureFlagService",
)<FeatureFlagServiceTag, FeatureFlagService>() {}

export class RemoteConfigServiceTag extends Context.Tag(
  "AmicalApp/RemoteConfigService",
)<RemoteConfigServiceTag, RemoteConfigService>() {}

export class ModelServiceTag extends Context.Tag("AmicalApp/ModelService")<
  ModelServiceTag,
  ModelService
>() {}

export class OnboardingServiceTag extends Context.Tag(
  "AmicalApp/OnboardingService",
)<OnboardingServiceTag, OnboardingService>() {}

export class NativeBridgeTag extends Context.Tag("AmicalApp/NativeBridge")<
  NativeBridgeTag,
  NativeBridge | null
>() {}

export class VadServiceTag extends Context.Tag("AmicalApp/VADService")<
  VadServiceTag,
  VADService
>() {}

export class TranscriptionServiceTag extends Context.Tag(
  "AmicalApp/TranscriptionService",
)<TranscriptionServiceTag, TranscriptionService | null>() {}

export class RecordingManagerTag extends Context.Tag(
  "AmicalApp/RecordingManager",
)<RecordingManagerTag, RecordingManager>() {}

export class ShortcutManagerTag extends Context.Tag(
  "AmicalApp/ShortcutManager",
)<ShortcutManagerTag, ShortcutManager>() {}

export class AutoUpdaterServiceTag extends Context.Tag(
  "AmicalApp/AutoUpdaterService",
)<AutoUpdaterServiceTag, AutoUpdaterService>() {}

export class TrpcHandlerTag extends Context.Tag("AmicalApp/TrpcHandler")<
  TrpcHandlerTag,
  ReturnType<typeof createIPCHandler>
>() {}

export class WindowManagerTag extends Context.Tag("AmicalApp/WindowManager")<
  WindowManagerTag,
  WindowManager
>() {}

/**
 * The graph's summary node: the frozen bundle of every ServiceMap service,
 * produced by ServicesBundleLive at the END of the graph. Depending on it
 * makes "sees a complete graph" a structural guarantee — the tRPC handler
 * can't exist without every service, and the boot handle's services() reads
 * this same object.
 */
export class ServicesBundleTag extends Context.Tag("AmicalApp/ServicesBundle")<
  ServicesBundleTag,
  Readonly<ServiceMap>
>() {}

/**
 * The crash path's early-ref record, injected at build time (build plumbing
 * like AppScopeTag — NOT part of AppServices). The Settings/Telemetry/
 * Onboarding acquires write themselves in the moment each instance exists,
 * so the boot handle's nullable accessors can serve a failed boot. This is
 * the graph's ONLY write-side channel — there is deliberately no locator to
 * read arbitrary services through.
 */
export class EarlyRefsTag extends Context.Tag("AmicalApp/EarlyRefs")<
  EarlyRefsTag,
  EarlyServiceRefs
>() {}

/**
 * The app-owned CloseableScope that service finalizers are registered on,
 * injected at build time. Deliberately NOT part of AppServices: it is build
 * plumbing, not a service. Finalizers must go on this scope (via
 * Scope.addFinalizer) instead of Effect.acquireRelease inside a layer,
 * because Layer.build is transactional in effect 3.21: a partial build
 * failure closes each layer's inner scope and would roll back every
 * already-acquired service — the old container kept them alive for the
 * crash path (verified empirically; see app-runtime.ts).
 */
export class AppScopeTag extends Context.Tag("AmicalApp/AppScope")<
  AppScopeTag,
  Scope.CloseableScope
>() {}

/** Union of every tag in the app graph — the Context the runtime builds. */
export type AppServices =
  | SettingsServiceTag
  | HistoryCleanupServiceTag
  | AuthServiceTag
  | PostHogClientTag
  | TelemetryServiceTag
  | FeatureFlagServiceTag
  | RemoteConfigServiceTag
  | ModelServiceTag
  | OnboardingServiceTag
  | NativeBridgeTag
  | VadServiceTag
  | TranscriptionServiceTag
  | RecordingManagerTag
  | ShortcutManagerTag
  | AutoUpdaterServiceTag
  | TrpcHandlerTag
  | WindowManagerTag
  | ServicesBundleTag;
