import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Deletion-sweep gates: the legacy error surfaces must not reappear, and the
 * `.errorCode` reads that remain are the frozen contract sites, pinned by
 * per-file count (a file-level allowlist cannot fail when a forbidden read
 * shares a file with permitted ones).
 */

const ROOT = join(__dirname, "..", "..");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "gen") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

const sources = () => [
  ...walk(join(ROOT, "src")),
  ...walk(join(ROOT, "tests")),
];

const countIn = (file: string, pattern: RegExp): number =>
  (readFileSync(file, "utf8").match(pattern) ?? []).length;

describe("error model sweep gates", () => {
  it("no legacy error class survives anywhere", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      if (file.endsWith("error-model-sweep.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const banned of [
        "new AppError",
        "instanceof AppError",
        "GrpcDictationError",
        "mapDictationErrorCodeToErrorCode",
      ]) {
        if (text.includes(banned)) {
          offenders.push(`${file}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("`.errorCode` reads exist only at the frozen contract sites, at their pinned counts", () => {
    const allowed: Record<string, number> = {
      // i18n key literals, not property reads
      "src/types/widget-notification.ts": 26,
      // frozen notification contract
      "src/trpc/routers/recording.ts": 3,
      "src/renderer/widget/hooks/useWidgetNotifications.tsx": 1,
      // trace record/attribute contract reads (never thrown-error
      // extraction); occurrence count — one guarded read is two matches
      "src/main/telemetry/dictation-trace.ts": 5,
    };
    const counts: Record<string, number> = {};
    for (const file of walk(join(ROOT, "src"))) {
      const count = countIn(file, /\.errorCode/g);
      if (count > 0) {
        counts[file.slice(ROOT.length + 1).replaceAll("\\", "/")] = count;
      }
    }
    expect(counts).toEqual(allowed);
  });
});
