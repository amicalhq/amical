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
  markTranscriptionAudible,
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

  it("keeps audible sessions as re-transcribable failures, deletes silent ones", async () => {
    const silentWav = path.join(TEST_USER_DATA_PATH, "silent.wav");
    await fs.ensureFile(silentWav);

    await createProvisionalTranscription({
      sessionId: "died-speaking",
      audioFile: "/audio/kept.wav",
    });
    await markTranscriptionAudible("died-speaking");
    await createProvisionalTranscription({
      sessionId: "died-silent",
      audioFile: silentWav,
    });
    await createProvisionalTranscription({ sessionId: "settled" });
    await stampTranscriptionDisposition("settled", { disposition: "success" });

    const result = await runLifecycleRecovery();

    expect(result).toEqual({ recovered: 1, discarded: 1 });
    expect(rows()).toEqual([
      {
        session_id: "died-speaking",
        disposition: "failure",
        audio_file: "/audio/kept.wav",
        reason: "interrupted",
      },
      {
        session_id: "settled",
        disposition: "success",
        audio_file: null,
        reason: null,
      },
    ]);
    expect(await fs.pathExists(silentWav)).toBe(false);
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
