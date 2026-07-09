import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type ElectronApplication } from "@playwright/test";
import {
  launchAmical,
  closeAmical,
  packagedExecutablePath,
  resolveTarget,
  type AmicalLaunch,
} from "./helpers/launch";

// Regression guards for the Squirrel.Windows update-hook bug: Update.exe
// spawns the app with --squirrel-* args while an instance is running, and
// those spawns must never disturb it (historically they fired second-instance
// through the single-instance lock and popped the main window mid-update).
// Squirrel event hooks only exist on Windows, and argv-position semantics
// only match in a packaged exe.
test.skip(
  process.platform !== "win32" || resolveTarget() !== "packaged",
  "Squirrel.Windows behavior — requires win32 and the packaged target",
);

// Launch the packaged exe the way Update.exe launches hook processes: same
// profile as the running instance, so they contend for the same
// single-instance lock. Resolves once the probe exits (or is killed after a
// grace period — the assertions below don't depend on a clean exit).
async function spawnProbe(
  args: string[],
  userDataDir: string,
): Promise<{ exited: boolean }> {
  const child = spawn(packagedExecutablePath(), args, {
    env: {
      ...process.env,
      AMICAL_E2E: "1",
      AMICAL_E2E_USER_DATA_DIR: userDataDir,
      TELEMETRY_ENABLED: "false",
    },
    stdio: "ignore",
  });
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 15_000);
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", done);
    child.once("error", done);
  });
  if (!exited) child.kill();
  return { exited };
}

// Count second-instance events on the running app's own `app` emitter. The
// counter sees every event Electron dispatches, before/regardless of what the
// app's handler does with it.
async function instrumentSecondInstance(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    const g = globalThis as { __amicalE2eSecondInstance?: number };
    g.__amicalE2eSecondInstance = 0;
    electronApp.on("second-instance", () => {
      g.__amicalE2eSecondInstance = (g.__amicalE2eSecondInstance ?? 0) + 1;
    });
  });
}

function secondInstanceCount(app: ElectronApplication) {
  return app.evaluate(
    () =>
      (globalThis as { __amicalE2eSecondInstance?: number })
        .__amicalE2eSecondInstance ?? 0,
  );
}

function visibleWindowCount(app: ElectronApplication) {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length,
  );
}

// The packaged app logs to app.getPath("logs")/amical.log, which does NOT
// follow the e2e userData override — the file is shared with any prior runs,
// so callers must diff against a before-snapshot rather than expect it clean.
async function mainLogFile(app: ElectronApplication): Promise<string> {
  const logsDir = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath("logs"),
  );
  return path.join(logsDir, "amical.log");
}

async function readLogSafe(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

test.describe("squirrel update hooks", () => {
  let launched: AmicalLaunch;

  test.beforeEach(async () => {
    launched = await launchAmical();
    await launched.app.firstWindow({ timeout: 60_000 });
    await instrumentSecondInstance(launched.app);
  });

  test.afterEach(async () => {
    await closeAmical(launched);
  });

  test("a hook process never reaches the single-instance lock", async () => {
    const { app, userDataDir } = launched;
    const windowsBefore = await visibleWindowCount(app);

    const { exited } = await spawnProbe(
      ["--squirrel-updated", "9.9.9"],
      userDataDir,
    );
    expect(exited).toBe(true);

    // The lock notification (if the entry gate ever regresses) is sent before
    // the probe exits; a short settle window is enough for it to land.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await secondInstanceCount(app)).toBe(0);
    expect(await visibleWindowCount(app)).toBe(windowsBefore);
  });

  test("second-instance events carrying --squirrel-* args are ignored", async () => {
    const { app, userDataDir } = launched;
    const windowsBefore = await visibleWindowCount(app);
    const logFile = await mainLogFile(app);
    const logOffsetBefore = (await readLogSafe(logFile)).length;

    // --squirrel-firstrun is the one Squirrel arg that proceeds to a normal
    // launch (electron-squirrel-startup returns false), so this probe really
    // contends for the lock and delivers a second-instance event whose
    // commandLine carries a --squirrel-* flag — the same shape an outgoing
    // version's --squirrel-obsolete hook produces. Also proves the counter
    // wiring works, which is what makes the 0 in the previous test meaningful.
    const { exited } = await spawnProbe(["--squirrel-firstrun"], userDataDir);
    expect(exited).toBe(true);

    await expect.poll(() => secondInstanceCount(app)).toBe(1);
    expect(await visibleWindowCount(app)).toBe(windowsBefore);
    // The app's handler must have bailed before acting: both of its action
    // paths log "Second instance attempted...".
    const appended = (await readLogSafe(logFile)).slice(logOffsetBefore);
    expect(appended).not.toContain("Second instance attempted");
  });
});
