import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Exit, Layer, Scope } from "effect";
import { AppScopeTag, ServicesBundleTag } from "../../src/main/runtime/tags";
import { TrpcHandlerLive } from "../../src/main/runtime/layers";
import type { ServiceMap } from "../../src/main/managers/service-manager";

// Override the setup-level electron-trpc mock (which only exposes handle):
// the bridge assertions need attach/detach spies on the handler instance.
const { attachWindow, detachWindow } = vi.hoisted(() => ({
  attachWindow: vi.fn(),
  detachWindow: vi.fn(),
}));
vi.mock("electron-trpc-experimental/main", () => ({
  createIPCHandler: vi.fn(() => ({
    handle: vi.fn(),
    attachWindow,
    detachWindow,
  })),
}));

/**
 * TrpcHandlerLive's window bridge: WindowManager's lifecycle events forward
 * to electron-trpc's attachWindow/detachWindow with the exact window
 * instance, once per event — omitting detach leaks per-window subscription
 * cleanups, double-attach would duplicate them. The emit timing that makes
 * detach safe (pre-destruction) is pinned by window-manager.test.ts.
 */
describe("TrpcHandlerLive window bridge", () => {
  let closeScope: (() => Promise<void>) | null = null;

  beforeEach(() => {
    attachWindow.mockClear();
    detachWindow.mockClear();
  });

  afterEach(async () => {
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
  });

  const build = async () => {
    // Only the manager's emitter surface matters to the bridge; the rest of
    // the bundle is captured for lazy per-request contexts, never touched.
    const windowManager = new EventEmitter();
    const services = { windowManager } as unknown as Readonly<ServiceMap>;

    const scope = Effect.runSync(Scope.make());
    await Effect.runPromise(
      Layer.build(
        TrpcHandlerLive.pipe(
          Layer.provide(Layer.succeed(ServicesBundleTag, services)),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.extend(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));

    return { windowManager };
  };

  it("attaches created windows and detaches closing ones — exact instance, once each", async () => {
    const { windowManager } = await build();
    expect(windowManager.listenerCount("window-created")).toBe(1);
    expect(windowManager.listenerCount("window-closing")).toBe(1);

    const first = { id: "first" };
    windowManager.emit("window-created", first);
    expect(attachWindow).toHaveBeenCalledTimes(1);
    expect(attachWindow.mock.calls[0][0]).toBe(first);
    expect(detachWindow).not.toHaveBeenCalled();

    windowManager.emit("window-closing", first);
    expect(detachWindow).toHaveBeenCalledTimes(1);
    expect(detachWindow.mock.calls[0][0]).toBe(first);

    // Recreate: the new instance attaches; the old one is not re-attached.
    const second = { id: "second" };
    windowManager.emit("window-created", second);
    expect(attachWindow).toHaveBeenCalledTimes(2);
    expect(attachWindow.mock.calls[1][0]).toBe(second);
  });

  it("drops the window subscriptions when the scope closes", async () => {
    const { windowManager } = await build();

    await closeScope!();
    closeScope = null;

    windowManager.emit("window-created", { id: "late" });
    windowManager.emit("window-closing", { id: "late" });
    expect(attachWindow).not.toHaveBeenCalled();
    expect(detachWindow).not.toHaveBeenCalled();
    expect(windowManager.listenerCount("window-created")).toBe(0);
    expect(windowManager.listenerCount("window-closing")).toBe(0);
  });
});
