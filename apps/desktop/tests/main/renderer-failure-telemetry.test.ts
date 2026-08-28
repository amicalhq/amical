import { EventEmitter } from "node:events";
import { app, BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installRendererFailureTelemetry } from "../../src/main/telemetry/renderer-failure-telemetry";
import type { WindowManager } from "../../src/main/core/window-manager";
import type { TelemetryService } from "../../src/services/telemetry-service";

function listenerFor(emitterOn: ReturnType<typeof vi.fn>, eventName: string) {
  const call = emitterOn.mock.calls.find(([event]) => event === eventName);
  if (!call) throw new Error(`Missing ${eventName} listener`);
  return call[1] as (...args: unknown[]) => void;
}

describe("renderer failure telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports Electron failures without changing the window", () => {
    const window = new BrowserWindow();
    const windows = new EventEmitter() as EventEmitter & {
      getMainWindow: () => BrowserWindow;
      getWidgetWindow: () => null;
      getNotesWindow: () => null;
      getOnboardingWindow: () => null;
    };
    windows.getMainWindow = () => window;
    windows.getWidgetWindow = () => null;
    windows.getNotesWindow = () => null;
    windows.getOnboardingWindow = () => null;

    const captureException = vi.fn();
    installRendererFailureTelemetry(
      windows as unknown as WindowManager,
      { captureException } as unknown as TelemetryService,
    );

    windows.emit("window-created", window);

    const webContentsOn = window.webContents.on as ReturnType<typeof vi.fn>;
    listenerFor(webContentsOn, "preload-error")(
      {},
      "/Applications/Amical/preload.js",
      new Error("preload failed"),
    );
    listenerFor(webContentsOn, "did-fail-load")(
      {},
      -105,
      "NAME_NOT_RESOLVED",
      "https://private.example/path",
      true,
      1,
      2,
    );
    listenerFor(webContentsOn, "did-fail-load")(
      {},
      -3,
      "ABORTED",
      "https://ignored.example",
      true,
      1,
      2,
    );
    listenerFor(webContentsOn, "did-fail-load")(
      {},
      -105,
      "NAME_NOT_RESOLVED",
      "https://ignored.example",
      false,
      1,
      2,
    );

    listenerFor(webContentsOn, "render-process-gone")(
      {},
      {
        reason: "crashed",
        exitCode: 9,
      },
    );
    listenerFor(webContentsOn, "render-process-gone")(
      {},
      {
        reason: "clean-exit",
        exitCode: 0,
      },
    );

    expect(captureException).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "preload failed" }),
      {
        error_context: "renderer_preload_failed",
        runtime: "main",
        surface: "main",
      },
    );
    expect(captureException).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "RendererLoadError" }),
      {
        error_context: "renderer_load_failed",
        runtime: "main",
        surface: "main",
        error_code: -105,
        error_description: "NAME_NOT_RESOLVED",
      },
    );
    expect(captureException).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ name: "RendererProcessGoneError" }),
      {
        error_context: "renderer_process_gone",
        runtime: "main",
        surface: "main",
        reason: "crashed",
        exit_code: 9,
      },
    );
    expect(window.reload).toBeUndefined();
  });

  it("reports non-clean Electron child-process failures", () => {
    const windows = new EventEmitter() as unknown as WindowManager;
    const captureException = vi.fn();
    installRendererFailureTelemetry(windows, {
      captureException,
    } as unknown as TelemetryService);

    const appOn = app.on as unknown as ReturnType<typeof vi.fn>;
    const listener = listenerFor(appOn, "child-process-gone");
    listener(
      {},
      {
        type: "GPU",
        reason: "oom",
        exitCode: 15,
        name: "GPU Process",
      },
    );
    listener(
      {},
      {
        type: "Utility",
        reason: "clean-exit",
        exitCode: 0,
      },
    );

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ElectronChildProcessGoneError" }),
      {
        error_context: "electron_child_process_gone",
        runtime: "main",
        surface: "app",
        process_type: "GPU",
        process_name: "GPU Process",
        reason: "oom",
        exit_code: 15,
      },
    );
  });
});
