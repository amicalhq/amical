import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  SettingsServiceTag,
  WindowManagerTag,
} from "../../src/main/runtime/tags";
import { WindowManager } from "../../src/main/core/window-manager";
import type { SettingsService } from "../../src/services/settings-service";

/**
 * The window lifecycle events the tRPC handler layer rides for attach/detach
 * (see TrpcHandlerLive and trpc-window-bridge.test.ts). The timing is
 * load-bearing: "window-closing" fires during Electron's pre-destruction
 * "close" — detaching an already-destroyed window would throw inside
 * electron-trpc, and skipping the detach would leak subscription cleanups.
 * One block per window type, since each has its own creation path and close
 * handler.
 */
describe("WindowManager lifecycle events", () => {
  let closeScope: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
  });

  // The manager is only constructible through its Live layer (see
  // tests/README.md).
  const buildManager = async () => {
    const settingsService = {
      getUISettings: vi.fn(async () => ({ theme: "system", locale: "en" })),
      updateSettings: vi.fn(async () => undefined),
    } as unknown as SettingsService;

    const scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        WindowManager.Live.pipe(
          Layer.provide(Layer.succeed(SettingsServiceTag, settingsService)),
        ),
      ).pipe(Scope.extend(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));

    const manager = Context.get(ctx, WindowManagerTag);
    const created: BrowserWindow[] = [];
    // Capture destruction state AT event time — the point of riding "close"
    // rather than "closed" is that the window is still live in the event.
    const closing: { window: BrowserWindow; destroyedAtEvent: boolean }[] = [];
    manager.on("window-created", (window) => created.push(window));
    manager.on("window-closing", (window) =>
      closing.push({ window, destroyedAtEvent: window.isDestroyed() }),
    );
    return { manager, created, closing };
  };

  const expectCloseThenRecreate = async (
    created: BrowserWindow[],
    closing: { window: BrowserWindow; destroyedAtEvent: boolean }[],
    recreate: () => Promise<void>,
  ) => {
    expect(created).toHaveLength(1);

    created[0].close();
    expect(closing).toHaveLength(1);
    expect(closing[0].window).toBe(created[0]);
    expect(closing[0].destroyedAtEvent).toBe(false);

    await recreate();
    expect(created).toHaveLength(2);
    expect(created[1]).not.toBe(created[0]);
  };

  it("main window: created → closing (pre-destruction) → recreated", async () => {
    const { manager, created, closing } = await buildManager();

    await manager.createOrShowMainWindow();

    await expectCloseThenRecreate(created, closing, () =>
      manager.createOrShowMainWindow(),
    );
  });

  it("widget window: created → closing (pre-destruction) → recreated", async () => {
    const { manager, created, closing } = await buildManager();

    await manager.createWidgetWindow();

    await expectCloseThenRecreate(created, closing, () =>
      manager.createWidgetWindow(),
    );
  });

  it("onboarding window: created → closing (pre-destruction) → recreated", async () => {
    const { manager, created, closing } = await buildManager();

    await manager.createOrShowOnboardingWindow();

    await expectCloseThenRecreate(created, closing, () =>
      manager.createOrShowOnboardingWindow(),
    );
  });

  it("notes window: created → closing (pre-destruction) → recreated", async () => {
    const { manager, created, closing } = await buildManager();

    // open() is fire-and-forget (bounds load is async before creation).
    manager.openNotesWindow();
    await vi.waitFor(() => expect(created).toHaveLength(1));

    created[0].close();
    expect(closing).toHaveLength(1);
    expect(closing[0].window).toBe(created[0]);
    expect(closing[0].destroyedAtEvent).toBe(false);

    manager.openNotesWindow();
    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created[1]).not.toBe(created[0]);
  });
});
