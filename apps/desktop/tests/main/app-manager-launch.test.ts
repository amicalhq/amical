import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { AppManager } from "../../src/main/core/app-manager";
import type { ServiceManager } from "../../src/main/managers/service-manager";

vi.mock("../../src/db/skills", () => ({ ensureSeededSkills: vi.fn() }));
vi.mock("../../src/main/migrations/data-migrations", () => ({
  runDataMigrations: vi.fn(),
}));
vi.mock("../../src/services/auth-service", () => ({ runAuthEffect: vi.fn() }));
vi.mock("../../src/main/utils/feature-flags", () => ({
  getMainFeatureFlagState: vi.fn(),
}));
vi.mock("../../src/main/menu", () => ({ setupApplicationMenu: vi.fn() }));
vi.mock("../../src/main/managers/tray-manager", () => ({
  TrayManager: { getInstance: () => ({ initialize: vi.fn() }) },
}));
vi.mock("../../src/main/telemetry/renderer-failure-telemetry", () => ({
  installRendererFailureTelemetry: vi.fn(),
}));

function createManager(needsOnboarding = false) {
  const windowManager = {
    ensureWidgetWindow: vi.fn(),
    createOrShowMainWindow: vi.fn(),
    createOrShowOnboardingWindow: vi.fn(),
    closeOnboardingWindow: vi.fn(),
    getMainWindow: vi.fn(() => null),
    getOnboardingWindow: vi.fn(() => null),
  };
  const onboardingService = Object.assign(new EventEmitter(), {
    checkNeedsOnboarding: vi.fn(async () => ({ needed: needsOnboarding })),
    startOnboardingFlow: vi.fn(),
  });
  const settingsService = Object.assign(new EventEmitter(), {
    syncAutoLaunch: vi.fn(),
    getPreferences: vi.fn(async () => ({ showInDock: false })),
  });
  const shortcutManager = Object.assign(new EventEmitter(), {
    setCommandsSuppressed: vi.fn(),
  });
  const services = {
    windowManager,
    onboardingService,
    settingsService,
    shortcutManager,
    telemetryService: { trackAppLaunch: vi.fn() },
  };
  const serviceManager = {
    initialize: vi.fn(),
    services: () => services,
  } as unknown as ServiceManager;
  return { manager: new AppManager(serviceManager), ...services };
}

beforeEach(() => vi.clearAllMocks());

describe("AppManager startup windows", () => {
  it("opens the main window by default", async () => {
    const { manager, windowManager } = createManager();
    await manager.initialize();
    expect(windowManager.ensureWidgetWindow).toHaveBeenCalledOnce();
    expect(windowManager.createOrShowMainWindow).toHaveBeenCalledOnce();
  });

  it("keeps dictation available without opening the main window on silent startup", async () => {
    const { manager, windowManager, settingsService } = createManager();
    await manager.initialize({ silentStart: true });
    expect(windowManager.ensureWidgetWindow).toHaveBeenCalledOnce();
    expect(settingsService.syncAutoLaunch).toHaveBeenCalledOnce();
    expect(windowManager.createOrShowMainWindow).not.toHaveBeenCalled();

    await manager.handleActivate();
    expect(windowManager.createOrShowMainWindow).toHaveBeenCalledOnce();
    manager.handleSecondInstance();
    expect(windowManager.createOrShowMainWindow).toHaveBeenCalledTimes(2);
  });

  it("still shows required onboarding during silent startup", async () => {
    const { manager, windowManager, onboardingService } = createManager(true);
    await manager.initialize({ silentStart: true });
    expect(onboardingService.startOnboardingFlow).toHaveBeenCalledOnce();
    expect(windowManager.createOrShowOnboardingWindow).toHaveBeenCalledOnce();
    expect(windowManager.createOrShowMainWindow).not.toHaveBeenCalled();
  });

  it("does not inherit silent-start after completing onboarding", async () => {
    const argv = process.argv;
    process.argv = ["Amical", "--silent-start"];
    try {
      const { manager, onboardingService } = createManager(true);
      await manager.initialize({ silentStart: true });
      onboardingService.emit("completed");
      expect(app.relaunch).toHaveBeenCalledWith({ args: [] });
    } finally {
      process.argv = argv;
    }
  });
});
