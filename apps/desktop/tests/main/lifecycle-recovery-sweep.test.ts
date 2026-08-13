import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "fs-extra";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { TEST_USER_DATA_PATH } from "../helpers/electron-mocks";
import { runLifecycleRecovery } from "../../src/main/lifecycle/startup-recovery";
import {
  createProvisionalTranscription,
  stampTranscriptionDisposition,
} from "../../src/db/transcriptions";

describe("lifecycle startup recovery", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  function rows() {
    return testDb.db.all<Record<string, unknown>>(
      sql`SELECT session_id, disposition, audio_file, json_extract(meta, '$.failureReason') AS reason FROM transcriptions ORDER BY id`,
    );
  }

  it("keeps rows whose WAV holds audio, deletes rows without an artifact", async () => {
    const keptWav = path.join(TEST_USER_DATA_PATH, "kept.wav");
    await fs.outputFile(keptWav, Buffer.alloc(100)); // header + payload
    const headerOnlyWav = path.join(TEST_USER_DATA_PATH, "header-only.wav");
    await fs.outputFile(headerOnlyWav, Buffer.alloc(44)); // no payload

    await createProvisionalTranscription({
      sessionId: "died-with-audio",
      audioFile: keptWav,
    });
    await createProvisionalTranscription({
      sessionId: "died-header-only",
      audioFile: headerOnlyWav,
    });
    await createProvisionalTranscription({ sessionId: "died-no-file" });
    await createProvisionalTranscription({ sessionId: "settled" });
    await stampTranscriptionDisposition("settled", { disposition: "success" });

    const result = await runLifecycleRecovery();

    expect(result).toEqual({ recovered: 1, discarded: 2 });
    expect(rows()).toEqual([
      {
        session_id: "died-with-audio",
        disposition: "failure",
        audio_file: keptWav,
        reason: "interrupted",
      },
      {
        session_id: "settled",
        disposition: "success",
        audio_file: null,
        reason: null,
      },
    ]);
    expect(await fs.pathExists(keptWav)).toBe(true);
    expect(await fs.pathExists(headerOnlyWav)).toBe(false);
  });

  it("never touches the excluded live session", async () => {
    await createProvisionalTranscription({ sessionId: "live" });
    const result = await runLifecycleRecovery({ excludeSession: "live" });
    expect(result).toEqual({ recovered: 0, discarded: 0 });
    expect(rows()).toEqual([
      {
        session_id: "live",
        disposition: null,
        audio_file: null,
        reason: null,
      },
    ]);
  });

  it("is a no-op on a clean database", async () => {
    await expect(runLifecycleRecovery()).resolves.toEqual({
      recovered: 0,
      discarded: 0,
    });
  });
});
