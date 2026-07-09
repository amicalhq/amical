import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * The app under test runs its real startup OS integrations (login-item
 * registration via syncAutoLaunch, amical:// protocol registration) — we
 * deliberately don't gate them off, so tests exercise the true code paths.
 * Instead, snapshot the machine state before the suite and best-effort
 * restore it after. Failures warn loudly but never fail the suite.
 *
 * macOS only. The amical:// handler is not restored — the real installed
 * Amical re-registers itself on its next launch. Windows (registry) is not
 * implemented; see e2e/README.md.
 */

const STATE_FILE = path.join(__dirname, "..", ".artifacts", "os-state.json");

interface OsState {
  loginItemPaths: string[];
}

function loginItemPaths(): string[] {
  const out = execFileSync(
    "osascript",
    [
      "-e",
      'tell application "System Events" to get the path of every login item',
    ],
    { encoding: "utf8" },
  ).trim();
  return out ? out.split(", ") : [];
}

function countByPath(paths: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  return counts;
}

export function recordOsState(): void {
  if (process.platform === "win32") {
    console.warn(
      "[e2e] OS-state cleanup is not implemented on Windows — test runs may " +
        "leave registry entries behind (see e2e/README.md).",
    );
    return;
  }
  if (process.platform !== "darwin") return;

  try {
    const state: OsState = { loginItemPaths: loginItemPaths() };
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn("[e2e] Failed to snapshot login items:", error);
  }
}

export function cleanupOsState(): void {
  if (process.platform !== "darwin") return;
  if (!existsSync(STATE_FILE)) return;

  try {
    const before = JSON.parse(readFileSync(STATE_FILE, "utf8")) as OsState;
    const beforeCounts = countByPath(before.loginItemPaths);
    const afterCounts = countByPath(loginItemPaths());

    for (const [itemPath, afterCount] of afterCounts) {
      const surplus = afterCount - (beforeCounts.get(itemPath) ?? 0);
      for (let i = 0; i < surplus; i++) {
        try {
          execFileSync("osascript", [
            "-e",
            `tell application "System Events" to delete (first login item whose path is ${JSON.stringify(itemPath)})`,
          ]);
          console.log(`[e2e] Removed login item added by tests: ${itemPath}`);
        } catch (error) {
          console.warn(
            `[e2e] Failed to remove test-added login item ${itemPath} — ` +
              `remove it manually in System Settings → Login Items:`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.warn("[e2e] Login-item cleanup failed:", error);
  }
}
