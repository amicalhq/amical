import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import fs from "fs-extra";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { TEST_USER_DATA_PATH } from "../helpers/electron-mocks";
import { createStorageAdapter } from "../../src/main/lifecycle/adapters/storage";
import {
  createProvisionalTranscription,
  deleteProvisionalTranscription,
  enrichTranscriptionBySession,
  getUncommittedTranscriptions,
  markTranscriptionAudible,
  stampTranscriptionDisposition,
} from "../../src/db/transcriptions";
import { getLifetimeStats } from "../../src/db/daily-stats";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";

describe("lifecycle storage", () => {
  let testDb: TestDatabase;
  let facts: LifecyclePortFact[];
  let adapter: ReturnType<typeof createStorageAdapter>;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    facts = [];
    adapter = createStorageAdapter((fact) => facts.push(fact));
  });

  afterEach(async () => {
    await testDb.close();
  });

  async function rowFor(sessionId: string) {
    const rows = testDb.db.all<Record<string, unknown>>(
      sql`SELECT * FROM transcriptions WHERE session_id = ${sessionId}`,
    );
    return rows[0] ?? null;
  }

  async function waitForFact(type: string) {
    await vi.waitFor(() =>
      expect(facts.some((fact) => fact.type === type)).toBe(true),
    );
  }

  it("stamps success onto the custody row, counts stats, keeps audio", async () => {
    await createProvisionalTranscription({
      sessionId: "s1",
      audioFile: "/tmp/does-not-matter.wav",
    });
    adapter.commit("s1", { kind: "success", text: "hello wide world" });
    await waitForFact("storageFinished");

    const row = await rowFor("s1");
    expect(row).toMatchObject({
      disposition: "success",
      text: "hello wide world",
      audio_file: "/tmp/does-not-matter.wav",
    });
    expect(await getLifetimeStats()).toEqual({
      totalWords: 3,
      totalTranscriptions: 1,
    });
  });

  it("stamps empty and failure as counted transcriptions with zero words", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    adapter.commit("s1", { kind: "empty" });
    await waitForFact("storageFinished");
    expect((await rowFor("s1"))?.disposition).toBe("empty");

    facts = [];
    await createProvisionalTranscription({ sessionId: "s2" });
    adapter.commit("s2", { kind: "failure", cause: "PROVIDER_DOWN" });
    await waitForFact("storageFinished");
    const failed = await rowFor("s2");
    expect(failed?.disposition).toBe("failure");
    expect(JSON.parse(String(failed?.meta))).toMatchObject({
      failureReason: "PROVIDER_DOWN",
    });

    expect(await getLifetimeStats()).toEqual({
      totalWords: 0,
      totalTranscriptions: 2,
    });
  });

  it("stamps dismissed without counting stats", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    adapter.commit("s1", { kind: "dismissed" });
    await waitForFact("storageFinished");
    expect((await rowFor("s1"))?.disposition).toBe("dismissed");
    expect(await getLifetimeStats()).toEqual({
      totalWords: 0,
      totalTranscriptions: 0,
    });
  });

  it("discard deletes the custody row and its audio file", async () => {
    const audioFile = path.join(TEST_USER_DATA_PATH, "discard-me.wav");
    await fs.ensureFile(audioFile);
    await createProvisionalTranscription({ sessionId: "s1", audioFile });

    adapter.commit("s1", { kind: "discard", reason: "quick_release" });
    await waitForFact("storageFinished");

    expect(await rowFor("s1")).toBeNull();
    expect(await fs.pathExists(audioFile)).toBe(false);
    expect(await getLifetimeStats()).toEqual({
      totalWords: 0,
      totalTranscriptions: 0,
    });
  });

  it("reports storageFinished for sessions that never opened custody", async () => {
    adapter.commit("s-never", { kind: "discard", reason: "interrupted_start" });
    await waitForFact("storageFinished");
    expect(await rowFor("s-never")).toBeNull();
  });

  it("stamp is CAS-guarded: a settled row cannot be re-stamped", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    const first = await stampTranscriptionDisposition("s1", {
      disposition: "success",
      text: "kept",
    });
    expect(first).not.toBeNull();

    const second = await stampTranscriptionDisposition("s1", {
      disposition: "dismissed",
    });
    expect(second).toBeNull();
    expect(await rowFor("s1")).toMatchObject({
      disposition: "success",
      text: "kept",
    });

    // Same for deletion: a settled row is not custody any more.
    expect(await deleteProvisionalTranscription("s1")).toBeNull();
    expect(await rowFor("s1")).not.toBeNull();
  });

  it("scan returns only session-keyed uncommitted rows", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    await createProvisionalTranscription({ sessionId: "s2" });
    await stampTranscriptionDisposition("s2", { disposition: "success" });
    // Legacy-shaped row: no session key — never recovery's business.
    testDb.db.run(sql`INSERT INTO transcriptions (text) VALUES ('legacy row')`);

    const uncommitted = await getUncommittedTranscriptions();
    expect(uncommitted.map((row) => row.sessionId)).toEqual(["s1"]);
  });

  it("records audibility and descriptive enrichment on the custody row", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    await markTranscriptionAudible("s1");
    await enrichTranscriptionBySession("s1", {
      duration: 7,
      speechModel: "base-en",
    });
    const row = await rowFor("s1");
    expect(row).toMatchObject({
      audible: 1,
      duration: 7,
      speech_model: "base-en",
    });
    const uncommitted = await getUncommittedTranscriptions();
    expect(uncommitted[0]?.audible).toBe(true);
  });

  it("migration backfill settles legacy rows using their meta status", async () => {
    // Re-run the shipped 0008 backfill statements against legacy-shaped rows.
    const migration = readFileSync(
      path.join(process.cwd(), "src/db/migrations/0008_cold_morbius.sql"),
      "utf8",
    );
    const backfills = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith("UPDATE"));
    expect(backfills).toHaveLength(2);

    testDb.db.run(
      sql`INSERT INTO transcriptions (text, disposition, meta) VALUES ('ok', NULL, '{"sessionId":"legacy-1"}')`,
    );
    testDb.db.run(
      sql`INSERT INTO transcriptions (text, disposition, meta) VALUES ('', NULL, '{"sessionId":"legacy-2","status":"failed"}')`,
    );
    testDb.db.run(
      sql`INSERT INTO transcriptions (text, disposition, meta) VALUES ('', NULL, '{"sessionId":"legacy-3","status":"dismissed"}')`,
    );
    for (const statement of backfills) {
      testDb.db.run(sql.raw(statement));
    }

    const rows = testDb.db.all<Record<string, unknown>>(
      sql`SELECT session_id, disposition FROM transcriptions ORDER BY id`,
    );
    expect(rows).toEqual([
      { session_id: "legacy-1", disposition: "success" },
      { session_id: "legacy-2", disposition: "failure" },
      { session_id: "legacy-3", disposition: "dismissed" },
    ]);
    expect(await getUncommittedTranscriptions()).toEqual([]);
  });
});
