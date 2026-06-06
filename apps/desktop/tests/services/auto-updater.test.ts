import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { app, autoUpdater, net } from "electron";
import {
  AutoUpdaterService,
  classifyUpdaterError,
} from "../../src/main/services/auto-updater";

describe("classifyUpdaterError", () => {
  it("classifies macOS read-only volume updater failures as known noise", () => {
    const error = new Error(
      "Cannot update while running on a read-only volume. The application is on a read-only volume.",
    );

    expect(classifyUpdaterError(error, "darwin")).toBe("read_only_volume");
  });

  it("does not classify the same message as known noise on non-macOS platforms", () => {
    const error = new Error(
      "Cannot update while running on a read-only volume. The application is on a read-only volume.",
    );

    expect(classifyUpdaterError(error, "win32")).toBe("generic");
  });

  it("keeps unrelated updater errors as generic", () => {
    expect(
      classifyUpdaterError(
        new Error("Remote release File is empty or corrupted"),
        "darwin",
      ),
    ).toBe("generic");
  });
});

// The state machine only runs in packaged builds. Flip the mocked `app` to
// packaged, drive the mocked Squirrel `autoUpdater` events, and assert the
// observable state. Fake timers neutralise the startup/interval checks that
// initialize() schedules.
describe("AutoUpdaterService", () => {
  let service: AutoUpdaterService;
  let telemetry: { captureException: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    autoUpdater.removeAllListeners();
    vi.clearAllMocks();

    telemetry = { captureException: vi.fn() };
    service = new AutoUpdaterService();
    await service.initialize(
      {
        getUpdateChannel: vi.fn().mockResolvedValue("stable"),
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      } as any,
      telemetry as any,
    );
  });

  afterEach(() => {
    service.cleanup();
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
  });

  describe("state transitions", () => {
    it("starts in not-available", () => {
      expect(service.getUpdateState()).toBe("not-available");
    });

    it("walks checking → available → downloaded, emitting state-changed each step", () => {
      const seen: string[] = [];
      service.on("state-changed", () => seen.push(service.getUpdateState()));

      autoUpdater.emit("checking-for-update");
      expect(service.getUpdateState()).toBe("checking");

      autoUpdater.emit("update-available");
      expect(service.getUpdateState()).toBe("available");

      autoUpdater.emit("update-downloaded", {}, "## notes", "1.8.0");
      expect(service.getUpdateState()).toBe("downloaded");
      expect(service.isDownloaded()).toBe(true);

      expect(seen).toEqual(["checking", "available", "downloaded"]);
    });

    it("settles to not-available when no update is found and nothing is staged", () => {
      autoUpdater.emit("checking-for-update");
      autoUpdater.emit("update-not-available");
      expect(service.getUpdateState()).toBe("not-available");
    });

    it("settles to downloaded when a later check finds nothing but one is staged", () => {
      autoUpdater.emit("update-downloaded", {}, "## notes", "1.8.0");
      autoUpdater.emit("update-not-available");
      expect(service.getUpdateState()).toBe("downloaded");
    });

    it("dedups repeated identical states (one state-changed per change)", () => {
      const spy = vi.fn();
      service.on("state-changed", spy);

      autoUpdater.emit("checking-for-update");
      autoUpdater.emit("checking-for-update");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(service.getUpdateState()).toBe("checking");
    });

    it("surfaces a generic updater error as the error state and reports telemetry", () => {
      autoUpdater.emit(
        "error",
        new Error("Remote release File is empty or corrupted"),
      );

      expect(service.getUpdateState()).toBe("error");
      expect(telemetry.captureException).toHaveBeenCalledOnce();
    });

    it("invalidates a staged update after a generic updater error", async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ action: "prompt", version: "1.8.0" }),
      } as any);

      await service.checkForUpdates(true);
      autoUpdater.emit("update-downloaded", {}, "## notes", "1.8.0");
      expect(service.isDownloaded()).toBe(true);
      expect(service.getUpdatePrompt()).toMatchObject({
        action: "prompt",
        version: "1.8.0",
      });

      autoUpdater.emit("error", new Error("Remote release File is corrupted"));

      expect(service.getUpdateState()).toBe("error");
      expect(service.isDownloaded()).toBe(false);
      expect(service.getUpdatePrompt()).toBeNull();

      service.quitAndInstall();
      expect(vi.mocked(autoUpdater.quitAndInstall)).not.toHaveBeenCalled();
      expect(vi.mocked(autoUpdater.setFeedURL)).toHaveBeenLastCalledWith({
        url: expect.stringContaining("/0.1.0-test"),
      });
    });

    it("treats a macOS read-only-volume error as noise (settles, no error, no telemetry)", () => {
      const original = process.platform;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      try {
        autoUpdater.emit(
          "error",
          new Error("Cannot update while running on a read-only volume."),
        );

        expect(service.getUpdateState()).toBe("not-available");
        expect(telemetry.captureException).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, "platform", {
          value: original,
          configurable: true,
        });
      }
    });
  });

  describe("checkForUpdates", () => {
    it("skips the native check when metadata reports action 'none'", async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ action: "none" }),
      } as any);

      await service.checkForUpdates(true);

      expect(vi.mocked(autoUpdater.checkForUpdates)).not.toHaveBeenCalled();
      expect(service.getUpdateState()).toBe("not-available");
    });

    it("runs the native check when an update is offered", async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ action: "silent", version: "1.8.0" }),
      } as any);

      await service.checkForUpdates(true);

      expect(vi.mocked(autoUpdater.checkForUpdates)).toHaveBeenCalledOnce();
    });

    it("ignores a re-entrant check while one is already in flight", async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ action: "silent", version: "1.8.0" }),
      } as any);

      await Promise.all([service.checkForUpdates(), service.checkForUpdates()]);

      expect(vi.mocked(net.fetch)).toHaveBeenCalledOnce();
    });

    it("short-circuits a manual check when an update is already downloaded", async () => {
      autoUpdater.emit("update-downloaded", {}, "## notes", "1.8.0");

      await service.checkForUpdates(true);

      expect(vi.mocked(net.fetch)).not.toHaveBeenCalled();
      expect(service.getUpdateState()).toBe("downloaded");
    });

    it("invalidates a staged update when the native check throws", async () => {
      autoUpdater.emit("update-downloaded", {}, "## notes", "1.8.0");
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ action: "silent", version: "1.9.0" }),
      } as any);
      vi.mocked(autoUpdater.checkForUpdates).mockImplementationOnce(() => {
        throw new Error("native check failed");
      });

      await service.checkForUpdates();

      expect(service.getUpdateState()).toBe("error");
      expect(service.isDownloaded()).toBe(false);
      expect(vi.mocked(autoUpdater.setFeedURL)).toHaveBeenLastCalledWith({
        url: expect.stringContaining("/0.1.0-test"),
      });
    });
  });

  describe("quitAndInstall", () => {
    it("does not install when no update has been downloaded", () => {
      service.quitAndInstall();
      expect(vi.mocked(autoUpdater.quitAndInstall)).not.toHaveBeenCalled();
    });

    it("installs once an update is downloaded", () => {
      autoUpdater.emit("update-downloaded", {}, "## notes", "1.8.0");

      service.quitAndInstall();

      expect(vi.mocked(autoUpdater.quitAndInstall)).toHaveBeenCalledOnce();
    });
  });
});
