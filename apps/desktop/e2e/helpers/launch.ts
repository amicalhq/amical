import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";

// At runtime (plain Node) the electron package resolves to the path of the
// electron binary; its types describe the in-app API, hence the cast.
import electronBinary from "electron";

const desktopRoot = path.resolve(__dirname, "../..");

export type LaunchTarget = "packaged" | "bundle";

export interface AmicalLaunch {
  app: ElectronApplication;
  target: LaunchTarget;
  userDataDir: string;
}

export function resolveTarget(): LaunchTarget {
  const target = process.env.AMICAL_E2E_TARGET ?? "packaged";
  if (target !== "packaged" && target !== "bundle") {
    throw new Error(
      `Unknown AMICAL_E2E_TARGET "${target}" — expected "packaged" or "bundle"`,
    );
  }
  return target;
}

export function packagedExecutablePath(): string {
  const dir = path.join(
    desktopRoot,
    "out",
    `Amical-${process.platform}-${process.arch}`,
  );
  const executable =
    process.platform === "darwin"
      ? path.join(dir, "Amical.app", "Contents", "MacOS", "Amical")
      : process.platform === "win32"
        ? path.join(dir, "Amical.exe")
        : path.join(dir, "Amical");
  if (!existsSync(executable)) {
    throw new Error(
      `No packaged app at ${executable}. Build one with ` +
        `\`AMICAL_E2E_PACKAGE=1 pnpm package\` (or run \`pnpm test:e2e:fresh\`).`,
    );
  }
  return executable;
}

function assertBundleBuilt(): void {
  const mainBundle = path.join(desktopRoot, ".vite", "build", "main.js");
  if (!existsSync(mainBundle)) {
    throw new Error(
      `No built bundles at ${mainBundle}. Produce production bundles with ` +
        `\`AMICAL_E2E_PACKAGE=1 pnpm package\` (or run \`pnpm test:e2e:fresh\`).`,
    );
  }
}

export async function launchAmical(): Promise<AmicalLaunch> {
  const target = resolveTarget();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "amical-e2e-"));
  const env = {
    ...process.env,
    // Skip the auto-updater (a packaged test build would otherwise hit GitHub).
    AMICAL_E2E: "1",
    // Isolated profile: fresh onboarding state, own single-instance lock.
    AMICAL_E2E_USER_DATA_DIR: userDataDir,
    // Runtime override — beats the bundled telemetry default (posthog-client).
    TELEMETRY_ENABLED: "false",
  };

  let app: ElectronApplication;
  if (target === "packaged") {
    app = await electron.launch({
      executablePath: packagedExecutablePath(),
      env,
      timeout: 60_000,
    });
  } else {
    assertBundleBuilt();
    app = await electron.launch({
      executablePath: electronBinary as unknown as string,
      // Pass the app dir (not main.js) so Electron reads package.json and
      // the app keeps its real name/version.
      args: [desktopRoot],
      env,
      timeout: 60_000,
    });
  }

  return { app, target, userDataDir };
}

/**
 * A window served from localhost means `.vite/build` holds dev bundles from
 * `forge start` (dev-server URL baked in), not production bundles — the
 * renderer can never load. Fail with a message that says how to fix it.
 */
export function assertNotStaleDevBundle(pageUrl: string): void {
  if (/^https?:\/\/localhost/.test(pageUrl)) {
    throw new Error(
      `Window loaded ${pageUrl}: .vite/ holds dev bundles (from \`forge start\`). ` +
        `Rebuild production bundles with \`AMICAL_E2E_PACKAGE=1 pnpm package\`.`,
    );
  }
}

export async function closeAmical(
  launch: AmicalLaunch | undefined,
): Promise<void> {
  if (!launch) return;
  try {
    // close() resolves once the app exits; kill if it wedges on shutdown.
    await Promise.race([
      launch.app.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("app.close() timed out")), 15_000),
      ),
    ]);
  } catch {
    launch.app.process().kill();
  }
  await rm(launch.userDataDir, { recursive: true, force: true });
}
