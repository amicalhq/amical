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
  it("moves a newly shown widget to the top on Windows", () => {
    const manager = createManager();
    const showInactive = vi.fn();
    const moveTop = vi.fn();
    Reflect.set(manager, "widgetWindow", {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      showInactive,
      moveTop,
    });

    manager.showWidget();

    expect(showInactive).toHaveBeenCalledOnce();
    expect(moveTop).toHaveBeenCalledOnce();
  });

  it("moves only an existing visible widget to the top", () => {
    const manager = createManager();
    const moveTop = vi.fn();
    const widgetWindow = {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      moveTop,
    };
    Reflect.set(manager, "widgetWindow", widgetWindow);

    manager.reassertWidgetZOrder();

    expect(moveTop).toHaveBeenCalledOnce();

    widgetWindow.isVisible.mockReturnValue(false);
    manager.reassertWidgetZOrder();

    widgetWindow.isVisible.mockReturnValue(true);
    widgetWindow.isDestroyed.mockReturnValue(true);
    manager.reassertWidgetZOrder();

    expect(moveTop).toHaveBeenCalledOnce();
  });

  it("does not change z-order outside Windows", () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const manager = createManager();
    const moveTop = vi.fn();
    Reflect.set(manager, "widgetWindow", {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      moveTop,
    });

    manager.reassertWidgetZOrder();

    expect(moveTop).not.toHaveBeenCalled();
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
