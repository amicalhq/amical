import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * D1 grep gate: every fiber on a span path must start on the shared
 * telemetry runtime, or its spans silently vanish (the tracer lives in that
 * runtime's context). Bare default-runtime entries are banned in these
 * files. Effect.runSync is allowed: it builds pure values (Deferred.make),
 * never span-carrying fibers.
 */
const SPAN_PATH_FILES = [
  "src/main/lifecycle/effect/session-work.ts",
  "src/main/lifecycle/adapters/storage.ts",
  "src/main/lifecycle/adapters/recorder.ts",
  "src/main/lifecycle/adapters/transcription.ts",
  "src/main/lifecycle/adapters/host.ts",
  "src/main/lifecycle/live.ts",
  "src/main/lifecycle/runtime.ts",
  "src/services/transcription-service.ts",
  "src/services/transcription/live-transcription-session.ts",
  "src/services/transcription/token-lock.ts",
  "src/services/transcription/effect-boundary.ts",
];

describe("telemetry runtime entry gate", () => {
  for (const file of SPAN_PATH_FILES) {
    it(`${file} has no bare Effect.runFork/runPromise`, () => {
      const source = readFileSync(join(__dirname, "../..", file), "utf8");
      const bare = source.match(
        /Effect\.(runFork|runPromise|runPromiseExit)\(/g,
      );
      expect(bare ?? []).toEqual([]);
    });
  }
});
