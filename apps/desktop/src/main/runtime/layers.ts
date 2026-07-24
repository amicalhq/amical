/**
 * Composition of the app service graph (AMIC-42).
 *
 * Converted services own their Live layer (a class-static `Live` colocated
 * with the implementation — see e.g. services/history-cleanup-service.ts);
 * this file only composes them into AppLive, plus the two wrappers that
 * intentionally remain central:
 *
 * - NativeBridgeLive: tests vi.mock the native-bridge-service MODULE with a
 *   spawn-less fake class that has no Live static, so the layer must live
 *   outside that module (the mock boundary).
 * - ServicesBundleLive / TrpcHandlerLive: composition-only glue (the frozen
 *   ServiceMap summary node, and the router + context over it), not service
 *   modules.
 *
 * THE LOAD-BEARING MECHANICS (apply to every Live, converted or central):
 *
 * 1. Releases register on the app-owned scope (AppScopeTag) via
 *    Scope.addFinalizer (layer-helpers.ts addRelease), NOT via
 *    Effect.acquireRelease: Layer.build is transactional in effect 3.21 and
 *    closes layer scopes on partial build failure, which would tear down
 *    PostHog before the crash path can flush telemetry (verified
 *    empirically; see app-runtime.ts). Finalizers on the app scope are
 *    invisible to Layer.build, so a failed boot leaves acquired services
 *    alive until cleanup() closes the scope.
 *
 * 2. The release is registered BEFORE initialize() runs (a mid-init
 *    rejection still gets torn down at cleanup), and every awaited init step
 *    is Effect.uninterruptible (a failing concurrent sibling must not
 *    abandon an in-flight initialize() detached).
 *
 * Dependency graph (solid = constructor dep, dotted = ordering-only edge):
 *
 *   EarlyRefs + AppScope (Layer.succeed at build)        Auth (Layer.sync)
 *        │                                                 │
 *   Settings ──► PostHog ──► Telemetry◄────────────────────┤
 *      │  │         │        │  │  │ │                     │
 *      │  │  ┌──────┴─────┬──┤  │  │ └───────┬─────────────┤
 *      │  │  ▼            ▼  ▼  ▼  ▼         ▼             │
 *      │  │ FeatureFlag  RemoteConfig◄───────┼─────────────┤
 *      │  │ Model◄───────────────────────────┼─────────────┘
 *      │  │ VAD   NativeBridge   HistoryCleanup   (mid-tier: concurrent)
 *      │  │  │     │    │
 *      │  └──┼─────┼────┼────► Onboarding (◄ Settings, Telemetry, Model)
 *      │     │     │    │          │
 *      │     ▼     ▼    ▼          ▼
 *      │   Transcription (◄ Model, VAD, Settings, Telemetry, Auth, Bridge, Onboarding)
 *      │         ╎
 *      │         ▼
 *        RecordingManager (◄ Transcription, Bridge, Settings, Model)
 *                │                    │
 *                ▼                    ▼
 *          ShortcutManager      AutoUpdater (◄ Settings, Telemetry, RC, Recording)
 *                │                    │
 *                └────────┬───────────┘
 *                         ▼
 *          ServicesBundle (◄ EVERY ServiceMap tag, incl. WindowManager)
 *                         │
 *                         ▼
 *              TrpcHandler (◄ Bundle; attach/detach via WM window events)
 *
 * Identity flows over events, not calls: auth emits "authenticated" /
 * "logged-out"; telemetry (identify/reset), remote config (reset), and model
 * (cloud auto-switch) subscribe in their Lives, and feature flags subscribe
 * to telemetry's "identity-changed" so a refresh fires only on an ACTUAL
 * identity change.
 *
 * Finalizer order at scope close is the reverse of registration order, and
 * registration happens at construction — dependents always release before
 * their dependencies, making "PostHog flushes last among capturers"
 * structural.
 *
 * All layers are MODULE CONSTS (class statics count) and must stay that way:
 * Layer memoization is by reference, so a layer constructed inside a
 * function would build its service twice.
 */

import { Effect, Layer, Scope } from "effect";
import type { BrowserWindow } from "electron";

import { logger } from "../logger";
import { addRelease, up } from "./layer-helpers";
import { isMacOS, isWindows } from "../../utils/platform";

import { SettingsService } from "../../services/settings-service";
import { SettingsSyncService } from "../../services/settings-sync-service";
import { AuthService } from "../../services/auth-service";
import { PostHogClient } from "../../services/posthog-client";
import { TelemetryService } from "../../services/telemetry-service";
import { FeatureFlagService } from "../../services/feature-flag-service";
import { RemoteConfigService } from "../../services/remote-config-service";
import { HistoryCleanupService } from "../../services/history-cleanup-service";
import { ModelService } from "../../services/model-service";
import { OnboardingService } from "../../services/onboarding-service";
import { NativeBridge } from "../../services/platform/native-bridge-service";
import { VADService } from "../../services/vad-service";
import { TranscriptionService } from "../../services/transcription-service";
import { RecordingManager } from "../managers/recording-manager";
import { ShortcutManager } from "../managers/shortcut-manager";
import { AutoUpdaterService } from "../services/auto-updater";
import { WindowManager } from "../core/window-manager";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { router } from "../../trpc/router";
import { createContext } from "../../trpc/context";

import {
  SettingsServiceTag,
  SettingsSyncServiceTag,
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
  ServicesBundleTag,
  TrpcHandlerTag,
  AppScopeTag,
  type EarlyRefsTag,
  type AppServices,
} from "./tags";

export const NativeBridgeLive: Layer.Layer<
  NativeBridgeTag,
  never,
  TelemetryServiceTag | AppScopeTag
> = Layer.effect(
  NativeBridgeTag,
  Effect.gen(function* () {
    const telemetryService = yield* TelemetryServiceTag;
    // Platform gate: the bridge (and its helper process) exists only on
    // macOS/Windows — Linux holds null, and the shortcut layer dies on it.
    if (!isMacOS() && !isWindows()) {
      return null;
    }
    const appScope = yield* AppScopeTag;
    // The constructor spawns the native helper process — that IS the acquire.
    const nativeBridge = new NativeBridge(telemetryService);
    yield* addRelease(
      appScope,
      "Stopping native helper...",
      "nativeBridge",
      () => nativeBridge.stopHelper(),
    );
    up("nativeBridge");
    return nativeBridge;
  }),
);

/**
 * The graph's summary node: the frozen bundle of every ServiceMap service.
 * Depending on all of them makes "the tRPC context sees a complete graph" a
 * structural guarantee instead of a timing argument — the handler below
 * (and the boot handle's services()) read this object.
 */
export const ServicesBundleLive: Layer.Layer<
  ServicesBundleTag,
  never,
  | SettingsServiceTag
  | AuthServiceTag
  | SettingsSyncServiceTag
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
  | WindowManagerTag
> = Layer.effect(
  ServicesBundleTag,
  Effect.gen(function* () {
    return Object.freeze({
      posthogClient: yield* PostHogClientTag,
      telemetryService: yield* TelemetryServiceTag,
      featureFlagService: yield* FeatureFlagServiceTag,
      remoteConfigService: yield* RemoteConfigServiceTag,
      modelService: yield* ModelServiceTag,
      transcriptionService: yield* TranscriptionServiceTag,
      settingsService: yield* SettingsServiceTag,
      authService: yield* AuthServiceTag,
      settingsSyncService: yield* SettingsSyncServiceTag,
      vadService: yield* VadServiceTag,
      nativeBridge: yield* NativeBridgeTag,
      autoUpdaterService: yield* AutoUpdaterServiceTag,
      recordingManager: yield* RecordingManagerTag,
      shortcutManager: yield* ShortcutManagerTag,
      windowManager: yield* WindowManagerTag,
      onboardingService: yield* OnboardingServiceTag,
    });
  }),
);

/**
 * The tRPC IPC handler: its only dependency is the bundle, so it cannot
 * exist before every ServiceMap service does. (HistoryCleanup sits outside
 * the bundle and may still be initializing — harmless, since Layer.build
 * awaits the whole graph before AppManager creates any window.) Window
 * attach/detach rides WindowManager's lifecycle events — emitted
 * synchronously at the same statements that used to call attach/detach
 * directly, and windows are only created by AppManager after the build, so
 * the subscription always exists first.
 */
export const TrpcHandlerLive: Layer.Layer<
  TrpcHandlerTag,
  never,
  ServicesBundleTag | AppScopeTag
> = Layer.effect(
  TrpcHandlerTag,
  Effect.gen(function* () {
    const services = yield* ServicesBundleTag;
    const appScope = yield* AppScopeTag;
    const handler = createIPCHandler({
      router,
      windows: [],
      createContext: async () => createContext(services),
    });
    const onWindowCreated = (window: BrowserWindow) =>
      handler.attachWindow(window);
    const onWindowClosing = (window: BrowserWindow) =>
      handler.detachWindow(window);
    services.windowManager.on("window-created", onWindowCreated);
    services.windowManager.on("window-closing", onWindowClosing);
    yield* Scope.addFinalizer(
      appScope,
      Effect.sync(() => {
        services.windowManager.off("window-created", onWindowCreated);
        services.windowManager.off("window-closing", onWindowClosing);
      }),
    );
    logger.main.info("tRPC handler initialized");
    up("trpcHandler");
    return handler;
  }),
);

/**
 * The composed app graph. Requires EarlyRefsTag and AppScopeTag (provided
 * at build time by app-runtime.ts — plain data, no locator). Independent
 * branches build CONCURRENTLY — ordering is expressed exclusively through
 * the tag dependencies above, so the spine (Settings -> PostHog ->
 * Telemetry) and the tail (Onboarding -> Transcription -> Recording ->
 * Shortcut -> Bundle -> Handler) stay sequential while the mid-tier (Model,
 * VAD, NativeBridge, FeatureFlag, RemoteConfig, HistoryCleanup) overlaps.
 * Any race discovered later gets one more ordering edge in the layer above
 * — never a restructure here.
 */
export const AppLive: Layer.Layer<
  AppServices,
  never,
  EarlyRefsTag | AppScopeTag
> = TrpcHandlerLive.pipe(
  Layer.provideMerge(ServicesBundleLive),
  Layer.provideMerge(
    Layer.mergeAll(
      ShortcutManager.Live,
      AutoUpdaterService.Live,
      SettingsSyncService.Live,
    ),
  ),
  Layer.provideMerge(RecordingManager.Live),
  Layer.provideMerge(WindowManager.Live),
  Layer.provideMerge(TranscriptionService.Live),
  Layer.provideMerge(OnboardingService.Live),
  Layer.provideMerge(
    Layer.mergeAll(
      ModelService.Live,
      VADService.Live,
      NativeBridgeLive,
      FeatureFlagService.Live,
      RemoteConfigService.Live,
      // Converted services own their Live (class-static, colocated with the
      // implementation); this file only composes them.
      HistoryCleanupService.Live,
    ),
  ),
  Layer.provideMerge(TelemetryService.Live),
  Layer.provideMerge(PostHogClient.Live),
  Layer.provideMerge(SettingsService.Live),
  Layer.provideMerge(AuthService.Live),
);
