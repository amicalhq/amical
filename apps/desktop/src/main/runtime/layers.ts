/**
 * Composition of the app service graph (AMIC-42).
 *
 * Converted services own their Live layer (a class-static `Live` colocated
 * with the implementation — see e.g. services/history-cleanup-service.ts);
 * this file only composes them into AppLive, plus the four wrappers that
 * intentionally remain central:
 *
 * - AuthServiceLive / OnboardingServiceLive: module singletons
 *   (getInstance) pending the statics-dissolution phase.
 * - NativeBridgeLive: tests vi.mock the native-bridge-service MODULE with a
 *   spawn-less fake class that has no Live static, so the layer must live
 *   outside that module (the mock boundary).
 * - RecordingManagerLive: constructor still takes the ServiceManager
 *   locator; converts in the windowManager/tRPC de-facade phase (knot 1).
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
 *   ServiceLocator + AppScope (Layer.succeed at build)   Auth (Layer.sync)
 *        │                                                 │
 *   Settings ──► PostHog ──► Telemetry                     │
 *      │  │         │        │  │  │ │                     │
 *      │  │  ┌──────┴─────┬──┤  │  │ └───────┬─────────────┤
 *      │  │  ▼            ▼  ▼  ▼  ▼         ▼             │
 *      │  │ FeatureFlag  RemoteConfig◄───────┼─────────────┤
 *      │  │ Model◄╌╌(auth backdoor)╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌┘
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
 * registration happens at construction — dependents always release before
 * their dependencies, making "PostHog flushes last among capturers"
 * structural.
 *
 * All layers are MODULE CONSTS (class statics count) and must stay that way:
 * Layer memoization is by reference, so a layer constructed inside a
 * function would build its service twice.
 */

import { Effect, Layer } from "effect";

import { logger } from "../logger";
import { addRelease, up } from "./layer-helpers";
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
  TelemetryServiceTag,
  ModelServiceTag,
  OnboardingServiceTag,
  NativeBridgeTag,
  TranscriptionServiceTag,
  RecordingManagerTag,
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
> = Layer.mergeAll(ShortcutManager.Live, AutoUpdaterService.Live).pipe(
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
  Layer.provideMerge(TelemetryService.Live),
  Layer.provideMerge(PostHogClient.Live),
  Layer.provideMerge(SettingsService.Live),
  Layer.provideMerge(AuthServiceLive),
);
