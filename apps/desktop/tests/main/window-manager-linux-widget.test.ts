import { afterEach, describe, expect, it, vi } from "vitest";
import { app, type BrowserWindow } from "electron";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  SettingsServiceTag,
  WindowManagerTag,
} from "../../src/main/runtime/tags";
import { WindowManager } from "../../src/main/core/window-manager";
import type { SettingsService } from "../../src/services/settings-service";

describe("WindowManager widget shape on Linux X11", () => {
  const platform = process.platform;
  let closeScope: (() => Promise<void>) | null = null;

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: platform });
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
  });

  async function buildWidget() {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.assign(app, {
      commandLine: { getSwitchValue: vi.fn(() => "x11") },
    });
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
      ).pipe(Scope.provide(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));
    const manager = Context.get(ctx, WindowManagerTag);
    const created: BrowserWindow[] = [];
    manager.on("window-created", (window) => created.push(window));
    await manager.createWidgetWindow();
    const setShape = vi.spyOn(created[0], "setShape");
    return { manager, setShape, widget: created[0] };
  }

  it("clips the idle widget to the pill and gives back the full window for a pass-through reason", async () => {
    const { manager, setShape, widget } = await buildWidget();

    const pill = { x: 280, y: 270, width: 80, height: 40 };
    manager.setWidgetHitAreas([pill]);
    manager.setWidgetIgnoreMouseEvents(true);
    expect(setShape).toHaveBeenLastCalledWith([
      { x: 264, y: 254, width: 112, height: 72 },
    ]);

    // A notification card is visible without a pass-through reason.
    manager.setWidgetHitAreas([
      pill,
      { x: 160, y: 180, width: 320, height: 60 },
    ]);
    expect(setShape).toHaveBeenLastCalledWith([
      { x: 264, y: 254, width: 112, height: 72 },
      { x: 144, y: 164, width: 352, height: 92 },
    ]);

    // Not an empty list: on X11 that hides the whole window.
    manager.setWidgetIgnoreMouseEvents(false);
    const { width, height } = widget.getBounds();
    expect(setShape).toHaveBeenLastCalledWith([{ x: 0, y: 0, width, height }]);
  });
});
