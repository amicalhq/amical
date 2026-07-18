import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Context, Exit, Scope } from "effect";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

// Deterministic platform gate: the graph under test always builds the bridge.
vi.mock("../../src/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, isMacOS: () => true, isWindows: () => false };
});

// Spawn-less NativeBridge: the real constructor spawns the native helper
// process (native-bridge-service.ts:262). The fake keeps the EventEmitter
// surface plus the methods ShortcutManager/RecordingManager call.
vi.mock("../../src/services/platform/native-bridge-service", async () => {
  // Imported inside the factory: vi.mock factories are hoisted above the
  // file's imports, so a top-level EventEmitter binding would be in TDZ here.
  const { EventEmitter } = await import("node:events");
  class NativeBridge extends EventEmitter {
    setShortcuts = vi.fn().mockResolvedValue(undefined);
    setAllowInjectedKeys = vi.fn().mockResolvedValue(undefined);
    recheckPressedKeys = vi.fn().mockResolvedValue(undefined);
    setDraftEnterCapture = vi.fn().mockResolvedValue(undefined);
    getAccessibilityContext = vi.fn().mockResolvedValue(null);
    call = vi.fn().mockResolvedValue(undefined);
    stopHelper = vi.fn();
  }
  return { NativeBridge };
});

import {
  buildAppServices,
  closeAppScope,
} from "../../src/main/runtime/app-runtime";
import {
  SettingsServiceTag,
  HistoryCleanupServiceTag,
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
  TrpcHandlerTag,
  WindowManagerTag,
  ServiceLocatorTag,
  type AppServices,
} from "../../src/main/runtime/tags";
import type { ServiceManager } from "../../src/main/managers/service-manager";
import { logger } from "../../src/main/logger";
import { PostHogClient } from "../../src/services/posthog-client";
import { TelemetryService } from "../../src/services/telemetry-service";
import { FeatureFlagService } from "../../src/services/feature-flag-service";
import { RemoteConfigService } from "../../src/services/remote-config-service";
import { TranscriptionService } from "../../src/services/transcription-service";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";

// vi.spyOn's Classes<Required<T>> key filter resolves to never for these
// service classes; the spy itself is sound (method lookup happens at call
// time inside the finalizer closures), so type through a narrow shape.
function spyOnMethod(target: object, method: string) {
  return vi.spyOn(
    target as Record<string, (...args: never[]) => unknown>,
    method,
  );
}

// The lazy getService() names RecordingManager pulls after boot, mapped to
// tags so the stub locator can serve them from the built context.
const TAGS_BY_NAME: Record<string, Context.Tag<never, never> | undefined> = {
  settingsService: SettingsServiceTag as never,
  telemetryService: TelemetryServiceTag as never,
  modelService: ModelServiceTag as never,
  transcriptionService: TranscriptionServiceTag as never,
  nativeBridge: NativeBridgeTag as never,
  vadService: VadServiceTag as never,
  recordingManager: RecordingManagerTag as never,
  shortcutManager: ShortcutManagerTag as never,
  windowManager: WindowManagerTag as never,
  featureFlagService: FeatureFlagServiceTag as never,
  remoteConfigService: RemoteConfigServiceTag as never,
  posthogClient: PostHogClientTag as never,
  authService: AuthServiceTag as never,
  onboardingService: OnboardingServiceTag as never,
  autoUpdaterService: AutoUpdaterServiceTag as never,
};

describe("app layer graph (pre-cutover)", () => {
  let testDb: TestDatabase;
  let builtCtx: Context.Context<AppServices> | null = null;
  let openScope: Scope.CloseableScope | null = null;
  let stubLocator: ServiceManager;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    builtCtx = null;
    stubLocator = {
      registerEarlyService: vi.fn(),
      getService: vi.fn((name: string) => {
        const tag = TAGS_BY_NAME[name];
        if (!builtCtx || !tag) {
          throw new Error(
            "ServiceManager not initialized. Call initialize() first.",
          );
        }
        return Context.get(builtCtx, tag as never);
      }),
      getLogger: () => logger,
    } as unknown as ServiceManager;
  });

  afterEach(async () => {
    if (openScope) {
      await closeAppScope(openScope);
      openScope = null;
    }
    await testDb.close();
    vi.restoreAllMocks();
  });

  async function build() {
    const { scope, exit } = await buildAppServices(stubLocator);
    openScope = scope;
    if (Exit.isSuccess(exit)) {
      builtCtx = exit.value;
    }
    return exit;
  }

  function earlyRefCalls() {
    return (stubLocator.registerEarlyService as ReturnType<typeof vi.fn>).mock
      .calls as [string, unknown][];
  }

  it("builds the full graph and every tag resolves", async () => {
    const exit = await build();

    expect(Exit.isSuccess(exit)).toBe(true);
    const ctx = builtCtx!;

    expect(Context.get(ctx, SettingsServiceTag)).toBeTruthy();
    expect(Context.get(ctx, HistoryCleanupServiceTag)).toBeTruthy();
    expect(Context.get(ctx, AuthServiceTag)).toBeTruthy();
    expect(Context.get(ctx, PostHogClientTag)).toBeTruthy();
    expect(Context.get(ctx, TelemetryServiceTag)).toBeTruthy();
    expect(Context.get(ctx, FeatureFlagServiceTag)).toBeTruthy();
    expect(Context.get(ctx, RemoteConfigServiceTag)).toBeTruthy();
    expect(Context.get(ctx, ModelServiceTag)).toBeTruthy();
    expect(Context.get(ctx, OnboardingServiceTag)).toBeTruthy();
    // Platform gate mocked to macOS, so the bridge must exist…
    expect(Context.get(ctx, NativeBridgeTag)).toBeTruthy();
    expect(Context.get(ctx, VadServiceTag)).toBeTruthy();
    // …and transcription init succeeds under the global mocks (non-null).
    expect(Context.get(ctx, TranscriptionServiceTag)).toBeTruthy();
    expect(Context.get(ctx, RecordingManagerTag)).toBeTruthy();
    expect(Context.get(ctx, ShortcutManagerTag)).toBeTruthy();
    expect(Context.get(ctx, AutoUpdaterServiceTag)).toBeTruthy();
    // Knot 1: the tRPC handler and WindowManager are graph services.
    expect(Context.get(ctx, TrpcHandlerTag)).toBeTruthy();
    expect(Context.get(ctx, WindowManagerTag)).toBeTruthy();
    expect(Context.get(ctx, ServiceLocatorTag)).toBe(stubLocator);
  });

  it("builds each service exactly once (layer memoization)", async () => {
    await build();
    const ctx = builtCtx!;

    // Single acquire per early-ref service: the acquire is the only caller of
    // registerEarlyService, so a re-built layer would register twice — and
    // the registered instance must be the one the tag exposes.
    for (const [name, tag] of [
      ["settingsService", SettingsServiceTag],
      ["telemetryService", TelemetryServiceTag],
      ["onboardingService", OnboardingServiceTag],
    ] as const) {
      const calls = earlyRefCalls().filter(([n]) => n === name);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toBe(Context.get(ctx, tag as never));
    }

    // Cross-dependent identity: dependents captured the SAME instances the
    // tags expose (a layer rebuilt per dependent would hand out a different
    // one). Field names from telemetry-service.ts:54 and
    // transcription-service.ts:89,93.
    const settings = Context.get(ctx, SettingsServiceTag);
    const telemetry = Context.get(ctx, TelemetryServiceTag) as unknown as {
      settingsService: unknown;
    };
    expect(telemetry.settingsService).toBe(settings);
    const transcription = Context.get(
      ctx,
      TranscriptionServiceTag,
    ) as unknown as { settingsService: unknown; telemetryService: unknown };
    expect(transcription.settingsService).toBe(settings);
    expect(transcription.telemetryService).toBe(
      Context.get(ctx, TelemetryServiceTag),
    );
  });

  it("registers early refs for the crash-path accessors", async () => {
    await build();

    const names = earlyRefCalls().map(([name]) => name);
    expect(names).toContain("settingsService");
    expect(names).toContain("telemetryService");
    expect(names).toContain("onboardingService");
  });

  it("locks the teardown order: dependents release before dependencies", async () => {
    await build();
    const ctx = builtCtx!;

    const spies = {
      shortcutCleanup: spyOnMethod(
        Context.get(ctx, ShortcutManagerTag),
        "cleanup",
      ),
      recordingCleanup: spyOnMethod(
        Context.get(ctx, RecordingManagerTag),
        "cleanup",
      ),
      stopHelper: spyOnMethod(Context.get(ctx, NativeBridgeTag)!, "stopHelper"),
      transcriptionDispose: spyOnMethod(
        Context.get(ctx, TranscriptionServiceTag)!,
        "dispose",
      ),
      modelCleanup: spyOnMethod(Context.get(ctx, ModelServiceTag), "cleanup"),
      vadDispose: spyOnMethod(Context.get(ctx, VadServiceTag), "dispose"),
      historyCleanup: spyOnMethod(
        Context.get(ctx, HistoryCleanupServiceTag),
        "cleanup",
      ),
      autoUpdaterCleanup: spyOnMethod(
        Context.get(ctx, AutoUpdaterServiceTag),
        "cleanup",
      ),
      featureFlagShutdown: spyOnMethod(
        Context.get(ctx, FeatureFlagServiceTag),
        "shutdown",
      ),
      remoteConfigShutdown: spyOnMethod(
        Context.get(ctx, RemoteConfigServiceTag),
        "shutdown",
      ),
      posthogShutdown: spyOnMethod(
        Context.get(ctx, PostHogClientTag),
        "shutdown",
      ),
    };

    const scope = openScope!;
    openScope = null;
    await closeAppScope(scope);

    // Every finalizer ran exactly once — all ten registered releases.
    for (const spy of Object.values(spies)) {
      expect(spy).toHaveBeenCalledTimes(1);
    }

    const order = (spy: ReturnType<typeof spyOnMethod>) =>
      spy.mock.invocationCallOrder[0];

    // Semantic teardown constraints, previously comment-enforced in the old
    // hand-ordered cleanup():
    // shortcuts stop firing before the recording drain…
    expect(order(spies.shortcutCleanup)).toBeLessThan(
      order(spies.recordingCleanup),
    );
    // …the drain completes before the native helper is killed…
    expect(order(spies.recordingCleanup)).toBeLessThan(
      order(spies.stopHelper),
    );
    // …the transcription dispose (step 5) sits between the drain and the
    // helper kill…
    expect(order(spies.recordingCleanup)).toBeLessThan(
      order(spies.transcriptionDispose),
    );
    expect(order(spies.transcriptionDispose)).toBeLessThan(
      order(spies.stopHelper),
    );
    // …the drain also precedes the model/VAD teardown it may still use…
    expect(order(spies.recordingCleanup)).toBeLessThan(
      order(spies.modelCleanup),
    );
    expect(order(spies.recordingCleanup)).toBeLessThan(
      order(spies.vadDispose),
    );
    // …and PostHog flushes last among the capturing services.
    expect(order(spies.featureFlagShutdown)).toBeLessThan(
      order(spies.posthogShutdown),
    );
    expect(order(spies.remoteConfigShutdown)).toBeLessThan(
      order(spies.posthogShutdown),
    );
    expect(order(spies.stopHelper)).toBeLessThan(order(spies.posthogShutdown));
  });

  it("holds the partial graph alive on a failed build (no rollback)", async () => {
    // Force a late-layer failure: shortcut init rejects after the rest of the
    // graph (spine, mid-tier, recording) has been acquired.
    spyOnMethod(ShortcutManager.prototype, "initialize").mockImplementation(
      () => Promise.reject(new Error("boot boom")),
    );
    const posthogShutdown = spyOnMethod(PostHogClient.prototype, "shutdown");
    const featureFlagShutdown = spyOnMethod(
      FeatureFlagService.prototype,
      "shutdown",
    );
    const remoteConfigShutdown = spyOnMethod(
      RemoteConfigService.prototype,
      "shutdown",
    );

    const exit = await build();
    expect(Exit.isFailure(exit)).toBe(true);

    // The crash-path contract: NOTHING rolled back — PostHog must still be
    // alive so captureExceptionImmediateAndShutdown can flush after the
    // failure (Layer.build's transactional rollback is defeated by
    // registering finalizers on the app scope; this pins that).
    expect(posthogShutdown).not.toHaveBeenCalled();
    expect(featureFlagShutdown).not.toHaveBeenCalled();
    expect(remoteConfigShutdown).not.toHaveBeenCalled();

    // Early refs registered before the failure — app.ts's crash telemetry
    // reads getTelemetryService() off these.
    const names = earlyRefCalls().map(([name]) => name);
    expect(names).toContain("settingsService");
    expect(names).toContain("telemetryService");

    // cleanup() then releases the partial graph, each finalizer exactly once.
    const scope = openScope!;
    openScope = null;
    await closeAppScope(scope);
    expect(posthogShutdown).toHaveBeenCalledTimes(1);
    expect(featureFlagShutdown).toHaveBeenCalledTimes(1);
    expect(remoteConfigShutdown).toHaveBeenCalledTimes(1);

    // Idempotence: closing an already-closed scope runs nothing again.
    await closeAppScope(scope);
    expect(posthogShutdown).toHaveBeenCalledTimes(1);
  });

  it("continues boot with a null transcription tag when its init fails (non-fatal)", async () => {
    spyOnMethod(
      TranscriptionService.prototype,
      "initialize",
    ).mockImplementation(() => Promise.reject(new Error("whisper broke")));
    const captureException = spyOnMethod(
      TelemetryService.prototype,
      "captureException",
    );

    const exit = await build();

    // Verbatim old initializeAIServices semantics: swallowed failure,
    // telemetry capture, boot continues with a null service.
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Context.get(builtCtx!, TranscriptionServiceTag)).toBeNull();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      source: "service_manager",
      stage: "initialize_ai_services",
    });
    expect(Context.get(builtCtx!, RecordingManagerTag)).toBeTruthy();
    expect(Context.get(builtCtx!, ShortcutManagerTag)).toBeTruthy();
  });
});
