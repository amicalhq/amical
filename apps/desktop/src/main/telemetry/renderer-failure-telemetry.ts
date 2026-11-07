import { app, type BrowserWindow } from "electron";
import type { WindowManager } from "../core/window-manager";
import type { TelemetryService } from "../../services/telemetry-service";

type WindowSurface = "main" | "widget" | "notes" | "onboarding" | "unknown";

function getWindowSurface(
  windowManager: WindowManager,
  window: BrowserWindow,
): WindowSurface {
  if (windowManager.getMainWindow() === window) return "main";
  if (windowManager.getWidgetWindow() === window) return "widget";
  if (windowManager.getNotesWindow() === window) return "notes";
  if (windowManager.getOnboardingWindow() === window) return "onboarding";
  return "unknown";
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export function installRendererFailureTelemetry(
  windowManager: WindowManager,
  telemetryService: TelemetryService,
): void {
  const onWindowCreated = (window: BrowserWindow): void => {
    const surface = getWindowSurface(windowManager, window);
    const contents = window.webContents;

    const onPreloadError = (
      _event: Electron.Event,
      _preloadPath: string,
      error: Error,
    ): void => {
      telemetryService.captureException(error, {
        error_context: "renderer_preload_failed",
        runtime: "main",
        surface,
      });
    };
    const onDidFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || errorCode === -3) return;
      telemetryService.captureException(
        namedError("RendererLoadError", "Renderer failed to load"),
        {
          error_context: "renderer_load_failed",
          runtime: "main",
          surface,
          error_code: errorCode,
          error_description: errorDescription,
        },
      );
    };
    const onRenderProcessGone = (
      _event: Electron.Event,
      details: Electron.RenderProcessGoneDetails,
    ): void => {
      if (details.reason === "clean-exit") return;
      telemetryService.captureException(
        namedError("RendererProcessGoneError", "Renderer process gone"),
        {
          error_context: "renderer_process_gone",
          runtime: "main",
          surface,
          reason: details.reason,
          exit_code: details.exitCode,
        },
      );
    };
    contents.on("preload-error", onPreloadError);
    contents.on("did-fail-load", onDidFailLoad);
    contents.on("render-process-gone", onRenderProcessGone);
  };

  const onChildProcessGone = (
    _event: Electron.Event,
    details: Electron.Details,
  ): void => {
    if (details.reason === "clean-exit") return;
    telemetryService.captureException(
      namedError(
        "ElectronChildProcessGoneError",
        "Electron child process gone",
      ),
      {
        error_context: "electron_child_process_gone",
        runtime: "main",
        surface: "app",
        process_type: details.type,
        process_name: details.name ?? details.serviceName ?? "unknown",
        reason: details.reason,
        exit_code: details.exitCode,
      },
    );
  };

  windowManager.on("window-created", onWindowCreated);
  app.on("child-process-gone", onChildProcessGone);
}
