/**
 * Effect Layers for the app service graph (AMIC-42 step 2).
 *
 * Each layer wraps an existing promise-based service class: the acquire runs
 * `new X(...)` + `initialize()` exactly as the old ServiceManager initializeX
 * methods did, and the release runs the class's cleanup/shutdown/dispose.
 *
 * TWO LOAD-BEARING MECHANICS:
 *
 * 1. Releases are registered on the app-owned scope (AppScopeTag) via
 *    Scope.addFinalizer, NOT via Effect.acquireRelease inside the layer.
 *    Layer.build is transactional in effect 3.21: on a partial build failure
 *    it closes each layer's inner scope, which would run acquireRelease
 *    finalizers immediately — tearing down PostHog before the crash path can
 *    flush telemetry (verified empirically; see app-runtime.ts). Finalizers
 *    on the app scope are invisible to Layer.build, so a failed boot leaves
 *    every acquired-so-far service ALIVE exactly like the old field-holding
 *    container, until cleanup() closes the scope.
 *
 * 2. The release is registered BEFORE initialize() runs, mirroring the old
 *    field-assign-before-await: a service whose constructor succeeded but
 *    whose initialize() rejected still gets torn down at cleanup(). And every
 *    awaited init step is wrapped in Effect.uninterruptible: when a
 *    concurrent sibling layer fails, Effect interrupts this fiber — without
 *    the mask it would abandon the in-flight initialize() promise (detached,
 *    unobservable), which the old sequential boot could never do.
 *
 * Dependency graph (solid = constructor dep, dotted = ordering-only edge):
 *
 *   ServiceLocator + AppScope (Layer.succeed at build)   Auth (Layer.sync)
 *        │                                                 │
 *   Settings ──► PostHog ──► Telemetry                     │
 *      │  │         │        │  │  │ │                     │
 *      │  │  ┌──────┴─────┬──┤  │  │ └───────┬─────────────┤
 *      │  │  ▼            ▼  ▼  ▼  ▼         ▼             │
 *      │  │ FeatureFlag  RemoteConfig◄───────┼─────────────┤
 *      │  │ Model◄╌╌(auth backdoor :241)╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌┘
 *      │  │ VAD   NativeBridge   HistoryCleanup   (mid-tier: concurrent)
 *      │  │  │     │    │
 *      │  └──┼─────┼────┼────► Onboarding (◄ Settings, Telemetry, Model)
 *      │     │     │    │          │
 *      │     ▼     ▼    ▼          ▼
 *      │   Transcription (◄ Model, VAD, Settings, Telemetry, Bridge, Onboarding)
 *      │         ╎
 *      │         ▼
 *      └╌╌╌► RecordingManager (◄ locator; ╌╌ Transcription, Bridge, Settings, Model)
 *                │                    │
 *                ▼                    ▼
 *          ShortcutManager      AutoUpdater (◄ Settings, Telemetry, RC, Recording)
 *
 * Finalizer order at scope close is the reverse of registration order, and
 * registration happens at construction — a dependent can only construct after
 * its dependencies finished building, so dependents always release before
 * their dependencies. That makes "PostHog flushes last among capturers" a
 * structural property instead of a comment.
 *
 * All layers are MODULE CONSTS and must stay that way: Layer memoization is
 * by reference, so a layer constructed inside a function would build its
 * service twice (two native-helper spawns, duplicate ipcMain.handle throw).
 */

import { Effect, Layer } from "effect";

import { logger } from "../logger";
import { addRelease, step, up } from "./layer-helpers";
import { setApplicationLocale } from "../../i18n/application-locale";
import { isMacOS, isWindows } from "../../utils/platform";

import { SettingsService } from "../../services/settings-service";
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
  ServiceLocatorTag,
  AppScopeTag,
  type AppServices,
} from "./tags";

export const AuthServiceLive: Layer.Layer<AuthServiceTag> = Layer.sync(
  AuthServiceTag,
  () => {
    const authService = AuthService.getInstance();
    logger.main.info("Auth service initialized");
    up("authService");
    return authService;
  },
);

export const SettingsServiceLive: Layer.Layer<
  SettingsServiceTag,
  never,
  ServiceLocatorTag
> = Layer.effect(
  SettingsServiceTag,
  Effect.gen(function* () {
    const locator = yield* ServiceLocatorTag;
    const settingsService = new SettingsService();
    // Early ref: visible to the facade's nullable accessor the moment the
    // instance exists (crash-telemetry path reads it mid-build).
    yield* Effect.sync(() =>
      locator.registerEarlyService("settingsService", settingsService),
    );
    const uiSettings = yield* step(() => settingsService.getUISettings());
    // Composition-root side effect owned by settings init today
    // (service-manager.ts initializeSettingsService).
    yield* Effect.sync(() => setApplicationLocale(uiSettings.locale));
    logger.main.info("Settings service initialized");
    up("settingsService");
    return settingsService;
  }),
);

export const TelemetryServiceLive: Layer.Layer<
  TelemetryServiceTag,
  never,
  PostHogClientTag | SettingsServiceTag | ServiceLocatorTag
> = Layer.effect(
  TelemetryServiceTag,
  Effect.gen(function* () {
    const locator = yield* ServiceLocatorTag;
    const posthogClient = yield* PostHogClientTag;
    const settingsService = yield* SettingsServiceTag;
    const telemetryService = new TelemetryService(
      posthogClient,
      settingsService,
    );
    yield* Effect.sync(() =>
      locator.registerEarlyService("telemetryService", telemetryService),
    );
    yield* step(() => telemetryService.initialize());
    logger.main.info("Telemetry service initialized");
    up("telemetryService");
    return telemetryService;
  }),
);

export const OnboardingServiceLive: Layer.Layer<
  OnboardingServiceTag,
  never,
  SettingsServiceTag | TelemetryServiceTag | ModelServiceTag | ServiceLocatorTag
> = Layer.effect(
  OnboardingServiceTag,
  Effect.gen(function* () {
    const locator = yield* ServiceLocatorTag;
    const settingsService = yield* SettingsServiceTag;
    const telemetryService = yield* TelemetryServiceTag;
    const modelService = yield* ModelServiceTag;
    const onboardingService = OnboardingService.getInstance(
      settingsService,
      telemetryService,
      modelService,
    );
    yield* Effect.sync(() =>
      locator.registerEarlyService("onboardingService", onboardingService),
    );
    logger.main.info("Onboarding service initialized");
    up("onboardingService");
    return onboardingService;
  }),
);

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

export const RecordingManagerLive: Layer.Layer<
  RecordingManagerTag,
  never,
  | ServiceLocatorTag
  | TranscriptionServiceTag
  | NativeBridgeTag
  | SettingsServiceTag
  | ModelServiceTag
  | AppScopeTag
> = Layer.effect(
  RecordingManagerTag,
  Effect.gen(function* () {
    const locator = yield* ServiceLocatorTag;
    // Ordering-only: RecordingManager pulls these lazily via the locator's
    // getService() after boot; the edges also pin the reverse release order
    // (recording drain completes before the helper/model/transcription go).
    yield* TranscriptionServiceTag;
    yield* NativeBridgeTag;
    yield* SettingsServiceTag;
    yield* ModelServiceTag;
    const appScope = yield* AppScopeTag;
    const recordingManager = new RecordingManager(locator);
    yield* addRelease(
      appScope,
      "Cleaning up recording manager...",
      "recordingManager",
      () => recordingManager.cleanup(),
    );
    logger.main.info("Recording manager initialized");
    up("recordingManager");
    return recordingManager;
  }),
);

export const ShortcutManagerLive: Layer.Layer<
  ShortcutManagerTag,
  never,
  SettingsServiceTag | NativeBridgeTag | RecordingManagerTag | AppScopeTag
> = Layer.effect(
  ShortcutManagerTag,
  Effect.gen(function* () {
    const settingsService = yield* SettingsServiceTag;
    const nativeBridge = yield* NativeBridgeTag;
    const recordingManager = yield* RecordingManagerTag;
    if (!nativeBridge) {
      // Unsupported platform (Linux): boot stays fatal with the old
      // initializeShortcutManager guard's exact message.
      return yield* Effect.die(
        new Error(
          "SettingsService, NativeBridge and RecordingManager must be initialized first",
        ),
      );
    }
    const appScope = yield* AppScopeTag;
    const shortcutManager = new ShortcutManager(settingsService, nativeBridge);
    yield* addRelease(
      appScope,
      "Cleaning up shortcut manager...",
      "shortcutManager",
      () => shortcutManager.cleanup(),
    );
    yield* step(() => shortcutManager.initialize());
    // Connect shortcut events to recording manager (old init step 14).
    yield* Effect.sync(() =>
      recordingManager.setupShortcutListeners(shortcutManager),
    );
    logger.main.info("Shortcut manager initialized");
    up("shortcutManager");
    return shortcutManager;
  }),
);

export const AutoUpdaterServiceLive: Layer.Layer<
  AutoUpdaterServiceTag,
  never,
  | SettingsServiceTag
  | TelemetryServiceTag
  | RemoteConfigServiceTag
  | RecordingManagerTag
  | AppScopeTag
> = Layer.effect(
  AutoUpdaterServiceTag,
  Effect.gen(function* () {
    const settingsService = yield* SettingsServiceTag;
    const telemetryService = yield* TelemetryServiceTag;
    const remoteConfigService = yield* RemoteConfigServiceTag;
    const recordingManager = yield* RecordingManagerTag;
    const appScope = yield* AppScopeTag;
    const autoUpdaterService = new AutoUpdaterService();
    yield* addRelease(
      appScope,
      "Cleaning up auto-updater...",
      "autoUpdaterService",
      () => autoUpdaterService.cleanup(),
    );
    yield* step(() =>
      autoUpdaterService.initialize(
        settingsService,
        telemetryService,
        remoteConfigService,
        recordingManager,
      ),
    );
    up("autoUpdaterService");
    return autoUpdaterService;
  }),
);

/**
 * The composed app graph. Requires ServiceLocatorTag and AppScopeTag
 * (provided at build time by app-runtime.ts). Independent branches build
 * CONCURRENTLY — ordering is expressed exclusively through the tag
 * dependencies above, so the spine (Settings -> PostHog -> Telemetry) and the
 * tail (Onboarding -> Transcription -> Recording -> Shortcut) stay sequential
 * while the mid-tier (Model, VAD, NativeBridge, FeatureFlag, RemoteConfig,
 * HistoryCleanup) overlaps. Any race discovered later gets one more ordering
 * edge in the layer above — never a restructure here.
 */
export const AppLive: Layer.Layer<
  Exclude<AppServices, ServiceLocatorTag>,
  never,
  ServiceLocatorTag | AppScopeTag
> = Layer.mergeAll(ShortcutManagerLive, AutoUpdaterServiceLive).pipe(
  Layer.provideMerge(RecordingManagerLive),
  Layer.provideMerge(TranscriptionService.Live),
  Layer.provideMerge(OnboardingServiceLive),
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
  Layer.provideMerge(TelemetryServiceLive),
  Layer.provideMerge(PostHogClient.Live),
  Layer.provideMerge(SettingsServiceLive),
  Layer.provideMerge(AuthServiceLive),
);
