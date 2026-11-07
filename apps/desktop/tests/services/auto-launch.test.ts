import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { SettingsService } from "../../src/services/settings-service";
import { isWindows } from "../../src/utils/platform";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(() => true),
}));
vi.mock("../../src/utils/platform", () => ({ isWindows: vi.fn() }));
vi.mock("../../src/db/app-settings", () => ({
  getSettingsSection: vi.fn(),
  updateSettingsSection: vi.fn(),
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}));

const packaged = app.isPackaged;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isWindows).mockReturnValue(true);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(spawn).mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child as ReturnType<typeof spawn>;
  });
  Object.defineProperty(app, "isPackaged", { value: true, configurable: true });
});
afterEach(() => {
  Object.defineProperty(app, "isPackaged", { value: packaged });
  vi.restoreAllMocks();
});

async function sync(launchAtLogin: boolean) {
  const service = SettingsService.createForTests();
  vi.spyOn(service, "getPreferences").mockResolvedValue({
    launchAtLogin,
  } as Awaited<ReturnType<typeof service.getPreferences>>);
  service.syncAutoLaunch();
  await new Promise((resolve) => setImmediate(resolve));
}

describe("login launch registration", () => {
  it("creates the Windows Startup shortcut with silent-start", async () => {
    await sync(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining("Update.exe"),
      [
        expect.stringMatching(/^--createShortcut=/),
        "--shortcut-locations=Startup",
        "--process-start-args=--silent-start",
      ],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("removes the Windows Startup shortcut when disabled", async () => {
    await sync(false);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      [
        expect.stringMatching(/^--removeShortcut=/),
        "--shortcut-locations=Startup",
      ],
      expect.any(Object),
    );
  });

  it("passes silent-start through the Windows fallback registration", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await sync(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ["--silent-start"],
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps native macOS registration (enabled: %s)",
    async (enabled) => {
      vi.mocked(isWindows).mockReturnValue(false);
      await sync(enabled);
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: enabled,
      });
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});
