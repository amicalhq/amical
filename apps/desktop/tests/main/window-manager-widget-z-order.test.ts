import { EventEmitter } from "node:events";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowManager } from "@main/core/window-manager";

const originalPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "win32",
  });
});

afterAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
});

const createManager = () =>
  Object.create(WindowManager.prototype) as WindowManager;

describe("WindowManager widget z-order recovery", () => {
  it("restores always-on-top status whenever the Windows widget is shown", () => {
    const manager = createManager();
    let visible = false;
    let alwaysOnTop = false;
    const showInactive = vi.fn(() => {
      visible = true;
    });
    const setAlwaysOnTop = vi.fn((flag: boolean) => {
      alwaysOnTop = flag;
    });
    Reflect.set(manager, "widgetWindow", {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => visible),
      showInactive,
      setAlwaysOnTop,
    });

    manager.showWidget();

    expect(showInactive).toHaveBeenCalledOnce();
    expect(alwaysOnTop).toBe(true);
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");

    // Recover again if topmost status is lost while the widget stays visible.
    alwaysOnTop = false;
    manager.showWidget();

    expect(alwaysOnTop).toBe(true);
    expect(setAlwaysOnTop).toHaveBeenCalledTimes(2);
  });

  it("restores always-on-top status only for an existing visible widget", () => {
    const manager = createManager();
    const setAlwaysOnTop = vi.fn();
    const widgetWindow = {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      setAlwaysOnTop,
    };
    Reflect.set(manager, "widgetWindow", widgetWindow);

    manager.reassertWidgetZOrder();

    expect(setAlwaysOnTop).toHaveBeenCalledOnce();

    widgetWindow.isVisible.mockReturnValue(false);
    manager.reassertWidgetZOrder();

    widgetWindow.isVisible.mockReturnValue(true);
    widgetWindow.isDestroyed.mockReturnValue(true);
    manager.reassertWidgetZOrder();

    expect(setAlwaysOnTop).toHaveBeenCalledOnce();
  });

  it("does not change z-order outside Windows", () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const manager = createManager();
    const setAlwaysOnTop = vi.fn();
    Reflect.set(manager, "widgetWindow", {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      setAlwaysOnTop,
    });

    manager.reassertWidgetZOrder();

    expect(setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("reasserts only after the notes window has closed", () => {
    const manager = createManager();
    const notesWindow = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
    });
    const close = vi.fn();
    Reflect.set(manager, "notesWindowController", {
      getWindow: () => notesWindow,
      close,
    });
    const reassert = vi
      .spyOn(manager, "reassertWidgetZOrder")
      .mockImplementation(() => undefined);

    manager.closeNotesWindow();

    expect(close).toHaveBeenCalledOnce();
    expect(reassert).not.toHaveBeenCalled();

    notesWindow.emit("closed");

    expect(reassert).toHaveBeenCalledOnce();
  });

  it("reasserts when an existing widget window is ensured", async () => {
    const manager = createManager();
    Reflect.set(manager, "widgetWindow", {
      isDestroyed: vi.fn(() => false),
    });
    const reassert = vi
      .spyOn(manager, "reassertWidgetZOrder")
      .mockImplementation(() => undefined);

    await manager.ensureWidgetWindow();

    expect(reassert).toHaveBeenCalledOnce();
  });
});
