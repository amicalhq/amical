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
 * - TrpcHandlerLive: composition-only glue (router + context over the
 *   locator), not a service module.
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
 *      └╌╌╌► RecordingManager (◄ locator; ╌╌ Transcription, Bridge, Settings, Model)
 *                │                    │
 *                ▼                    ▼
 *          ShortcutManager      AutoUpdater (◄ Settings, Telemetry, RC, Recording)
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
import { WindowManager } from "../core/window-manager";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { router } from "../../trpc/router";
import { createContext } from "../../trpc/context";

import {
  TelemetryServiceTag,
  NativeBridgeTag,
  TrpcHandlerTag,
  ServiceLocatorTag,
  AppScopeTag,
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
 * The tRPC IPC handler as a graph service. Context resolution is lazy (per
 * property access through the locator), so building the handler mid-graph is
 * safe: no renderer can call before a window exists, and windows are created
 * by AppManager only after the full build.
 */
export const TrpcHandlerLive: Layer.Layer<
  TrpcHandlerTag,
  never,
  ServiceLocatorTag
> = Layer.effect(
  TrpcHandlerTag,
  Effect.gen(function* () {
    const locator = yield* ServiceLocatorTag;
    const handler = createIPCHandler({
      router,
      windows: [],
      createContext: async () => createContext(locator),
    });
    logger.main.info("tRPC handler initialized");
    up("trpcHandler");
    return handler;
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
  Layer.provideMerge(RecordingManager.Live),
  Layer.provideMerge(WindowManager.Live),
  Layer.provideMerge(TrpcHandlerLive),
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
