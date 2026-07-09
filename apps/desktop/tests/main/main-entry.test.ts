import { describe, it, expect, vi, beforeEach } from "vitest";

let appModuleLoaded = false;

// vi.mock factories are cached in the mock registry and survive
// vi.resetModules(), so per-test behavior (squirrel flag, app-module failure)
// must be registered with vi.doMock before each fresh import of the entry.
async function importEntry(opts: { started?: boolean; appError?: Error } = {}) {
  vi.resetModules();
  vi.doMock("electron-squirrel-startup", () => ({
    default: opts.started ?? false,
  }));
  vi.doMock("@/main/app", () => {
    if (opts.appError) throw opts.appError;
    appModuleLoaded = true;
    return {};
  });

  await import("@/main/main");
  await vi.dynamicImportSettled();
  // dynamicImportSettled resolves when the import settles; the entry's .catch
  // continuation runs a tick later.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Return the electron mock instance the entry actually used.
  return await import("electron");
}

describe("main entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appModuleLoaded = false;
  });

  it("loads the app module", async () => {
    const { app, dialog } = await importEntry();

    expect(appModuleLoaded).toBe(true);
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("shows an error dialog and exits when the app module fails to load", async () => {
    const { app, dialog } = await importEntry({
      appError: new Error("boom"),
    });

    expect(appModuleLoaded).toBe(false);
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      "Amical failed to start",
      expect.any(String),
    );
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it("quits when invoked as a Squirrel event hook", async () => {
    const { app } = await importEntry({ started: true });

    expect(app.quit).toHaveBeenCalled();
  });
});
