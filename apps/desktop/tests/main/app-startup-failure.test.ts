import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  cleanup: vi.fn(),
  getTelemetryService: vi.fn(),
  captureExceptionImmediateAndShutdown: vi.fn(),
  showFatalStartupDialog: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../src/main/core/app-manager", () => ({
  AppManager: class {
    initialize = mocks.initialize;
    cleanup = mocks.cleanup;
    handleSecondInstance = vi.fn();
    handleDeepLink = vi.fn();
    handleActivate = vi.fn();
  },
}));

vi.mock("../../src/main/managers/service-manager", () => ({
  ServiceManager: class {
    getTelemetryService = mocks.getTelemetryService;
  },
}));

vi.mock("../../src/main/fatal-startup-dialog", () => ({
  showFatalStartupDialog: mocks.showFatalStartupDialog,
}));

vi.mock("../../src/main/logger", () => ({
  logger: {
    main: {
      error: mocks.logError,
      info: vi.fn(),
      warn: vi.fn(),
    },
    renderer: {},
  },
}));

vi.mock("../../src/utils/platform", () => ({
  isWindows: () => false,
}));

describe("application startup failure", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { app } = await import("electron");
    Object.assign(app, {
      requestSingleInstanceLock: vi.fn(() => true),
      setAsDefaultProtocolClient: vi.fn(),
    });
  });

  it("shows the original failure when telemetry shutdown rejects", async () => {
    const startupError = new Error("startup failed");
    const telemetryError = new Error("telemetry shutdown timed out");
    mocks.initialize.mockRejectedValue(startupError);
    mocks.captureExceptionImmediateAndShutdown.mockRejectedValue(
      telemetryError,
    );
    mocks.getTelemetryService.mockReturnValue({
      captureExceptionImmediateAndShutdown:
        mocks.captureExceptionImmediateAndShutdown,
    });
    mocks.showFatalStartupDialog.mockResolvedValue(undefined);

    await import("../../src/main/app");

    await vi.waitFor(() => {
      expect(mocks.showFatalStartupDialog).toHaveBeenCalledWith(
        startupError,
        "app_initialize",
      );
    });

    expect(mocks.captureExceptionImmediateAndShutdown).toHaveBeenCalledWith(
      startupError,
      {
        source: "main_process",
        stage: "app_initialize",
      },
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "Failed to flush startup failure telemetry",
      { error: telemetryError },
    );

    const { app } = await import("electron");
    expect(app.quit).toHaveBeenCalled();
  });
});
