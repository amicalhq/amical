import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SettingsService } from "../../src/services/settings-service";
import { isLinux, isWindows } from "../../src/utils/platform";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(() => true),
}));
vi.mock("../../src/utils/platform", () => ({
  isWindows: vi.fn(),
  isLinux: vi.fn(),
  LINUX_APP_ID: "amical-desktop",
}));
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
  vi.mocked(isLinux).mockReturnValue(false);
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

describe("Linux login launch", () => {
  let configHome: string;
  const env = process.env.XDG_CONFIG_HOME;
  const resourcesPath = process.resourcesPath;

  beforeEach(() => {
    vi.mocked(isWindows).mockReturnValue(false);
    vi.mocked(isLinux).mockReturnValue(true);
    configHome = mkdtempSync(path.join(os.tmpdir(), "amical-autostart-"));
    process.env.XDG_CONFIG_HOME = configHome;
    Object.defineProperty(process, "resourcesPath", {
      value: "/usr/lib/amical-desktop/resources",
      configurable: true,
    });
  });
  afterEach(() => {
    rmSync(configHome, { recursive: true, force: true });
    if (env === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = env;
    Object.defineProperty(process, "resourcesPath", {
      value: resourcesPath,
      configurable: true,
    });
  });

  const entry = () =>
    path.join(configHome, "autostart", "amical-desktop.desktop");
  // existsSync is mocked in this file; read the file for real.
  const entryExists = () => {
    try {
      readFileSync(entry());
      return true;
    } catch {
      return false;
    }
  };

  it("writes an autostart entry that starts the launcher silently, and removes it", async () => {
    await sync(true);
    expect(readFileSync(entry(), "utf8")).toContain(
      'Exec="/usr/lib/amical-desktop/resources/amical-launcher" --silent-start',
    );
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();

    await sync(false);
    expect(entryExists()).toBe(false);
  });

  it("writes nothing from a dev run", async () => {
    Object.defineProperty(app, "isPackaged", {
      value: false,
      configurable: true,
    });
    await sync(true);
    expect(entryExists()).toBe(false);
  });
});
