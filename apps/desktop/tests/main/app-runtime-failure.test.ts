import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

// Same deterministic environment as app-layers.test.ts: macOS platform gate
// and a spawn-less NativeBridge.
vi.mock("../../src/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, isMacOS: () => true, isWindows: () => false };
});

vi.mock("../../src/services/platform/native-bridge-service", async () => {
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

import { ServiceManager } from "../../src/main/managers/service-manager";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";
import { PostHogClient } from "../../src/services/posthog-client";
import { TelemetryService } from "../../src/services/telemetry-service";
import { logger } from "../../src/main/logger";

function spyOnMethod(target: object, method: string) {
  return vi.spyOn(
    target as Record<string, (...args: never[]) => unknown>,
    method,
  );
}

/**
 * Facade-level boot-failure semantics (AMIC-42 step 4). The graph-level
 * contract (no rollback, exactly-once release, close idempotence) is pinned
 * in app-layers.test.ts; these tests pin what app.ts's crash path actually
 * touches: the rethrown error's identity through Cause.squash, the nullable
 * accessors' early-ref visibility, and the facade cleanup latch.
 */
describe("ServiceManager boot failure (facade)", () => {
  let testDb: TestDatabase;
  let serviceManager: ServiceManager;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    serviceManager = new ServiceManager();
  });

  afterEach(async () => {
    // cleanup() is idempotent — a test that already cleaned up is fine.
    await serviceManager.cleanup();
    await testDb.close();
    vi.restoreAllMocks();
  });

  it("rethrows the ORIGINAL error, serves early refs, holds the graph until cleanup", async () => {
    spyOnMethod(ShortcutManager.prototype, "initialize").mockImplementation(
      () => Promise.reject(new Error("boot boom")),
    );
    const posthogShutdown = spyOnMethod(PostHogClient.prototype, "shutdown");

    let thrown: unknown;
    try {
      await serviceManager.initialize();
    } catch (error) {
      thrown = error;
    }

    // app.ts:119-131 does `error instanceof Error ? (error.stack ?? ...)` and
    // shows it in the dialog — the identity must survive Cause.squash with no
    // FiberFailure wrapper.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("boot boom");
    expect((thrown as Error).constructor.name).toBe("Error");

    // services() keeps the exact pre-ready throw…
    expect(() => serviceManager.services()).toThrow(
      "ServiceManager not initialized. Call initialize() first.",
    );
    // …while the crash path's nullable accessors serve the early refs.
    expect(serviceManager.getTelemetryService()).toBeInstanceOf(
      TelemetryService,
    );
    expect(serviceManager.getSettingsService()).toBeTruthy();

    // The partial graph is HELD: PostHog must still be alive so
    // captureExceptionImmediateAndShutdown can flush the crash event.
    expect(posthogShutdown).not.toHaveBeenCalled();

    // cleanup() releases the partial graph exactly once, and is idempotent.
    await serviceManager.cleanup();
    expect(posthogShutdown).toHaveBeenCalledTimes(1);
    await serviceManager.cleanup();
    expect(posthogShutdown).toHaveBeenCalledTimes(1);
  });

  it("second initialize is a warn-noop; cleanup before initialize is a no-op", async () => {
    // Pre-init cleanup: nothing to release, no throw.
    await serviceManager.cleanup();

    await serviceManager.initialize();
    const settings = serviceManager.services().settingsService;

    // Double init: warn-noop — same graph, same instances.
    await serviceManager.initialize();
    expect(serviceManager.services().settingsService).toBe(settings);
  });

  it("reports every cleanup defect while retaining the first rejection and idempotence", async () => {
    await serviceManager.initialize();
    const { shortcutManager, posthogClient } = serviceManager.services();
    const shortcutError = new Error("shortcut cleanup failed");
    const posthogError = new Error("posthog cleanup failed");
    const cleanup = shortcutManager.cleanup.bind(shortcutManager);
    const shutdown = posthogClient.shutdown.bind(posthogClient);
    const shortcutCleanup = spyOnMethod(
      shortcutManager,
      "cleanup",
    ).mockImplementation(() => {
      cleanup();
      throw shortcutError;
    });
    const posthogShutdown = spyOnMethod(
      posthogClient,
      "shutdown",
    ).mockImplementation(async () => {
      await shutdown();
      throw posthogError;
    });
    const logError = vi.spyOn(logger.main, "error");

    await expect(serviceManager.cleanup()).rejects.toBe(shortcutError);
    const report = logError.mock.calls.find(
      ([message]) =>
        typeof message === "string" &&
        message.startsWith("Service graph cleanup failed:"),
    )?.[0];
    expect(report).toContain(shortcutError.message);
    expect(report).toContain(posthogError.message);
    expect(shortcutCleanup).toHaveBeenCalledOnce();
    expect(posthogShutdown).toHaveBeenCalledOnce();

    await expect(serviceManager.cleanup()).resolves.toBeUndefined();
    expect(shortcutCleanup).toHaveBeenCalledOnce();
    expect(posthogShutdown).toHaveBeenCalledOnce();
  });
});
