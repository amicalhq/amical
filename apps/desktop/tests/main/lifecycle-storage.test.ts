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
  deleteAllTranscriptions,
  deleteProvisionalTranscription,
  deleteTranscription,
  enrichTranscriptionBySession,
  getLatestTranscription,
  getTranscriptionById,
  getTranscriptions,
  getTranscriptionsCount,
  getUncommittedTranscriptions,
  stampTranscriptionDisposition,
  updateTranscription,
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

  it("records descriptive enrichment on the custody row", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    await enrichTranscriptionBySession("s1", {
      duration: 7,
      speechModel: "base-en",
    });
    const row = await rowFor("s1");
    expect(row).toMatchObject({
      duration: 7,
      speech_model: "base-en",
    });
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

  it("stamps only after custody settles; the bound rescues a wedged writer", async () => {
    const { FakeTimers } = await import("../helpers/lifecycle-fakes");
    const timers = new FakeTimers();
    let releaseCustody!: (outcome: {
      audioFile: string | null;
      wavOk: boolean;
    }) => void;
    const custodyFacts: LifecyclePortFact[] = [];
    const custodyAdapter = createStorageAdapter(
      (fact) => custodyFacts.push(fact),
      {
        timers,
        custodySettleBoundMs: 9,
        awaitCustodySettled: () =>
          new Promise((resolve) => {
            releaseCustody = resolve;
          }),
      },
    );

    await createProvisionalTranscription({ sessionId: "s1" });
    custodyAdapter.commit("s1", { kind: "success", text: "ordered" });
    await new Promise((r) => setTimeout(r, 0));

    // Custody still open: no stamp, no fact — the row stays provisional.
    expect(custodyFacts).toEqual([]);
    expect((await rowFor("s1"))?.disposition).toBeNull();

    releaseCustody({ audioFile: null, wavOk: true });
    await vi.waitFor(async () => {
      expect((await rowFor("s1"))?.disposition).toBe("success");
    });
    expect(custodyFacts).toEqual([{ type: "storageFinished", session: "s1" }]);

    // Wedged writer: the bound fires and the stamp proceeds anyway.
    await createProvisionalTranscription({ sessionId: "s2" });
    custodyAdapter.commit("s2", { kind: "dismissed" });
    await new Promise((r) => setTimeout(r, 0));
    expect((await rowFor("s2"))?.disposition).toBeNull();
    timers.fire(9);
    await vi.waitFor(async () => {
      expect((await rowFor("s2"))?.disposition).toBe("dismissed");
    });
  });

  it("a broken WAV is detached and unlinked; the row still settles", async () => {
    const brokenWav = path.join(TEST_USER_DATA_PATH, "broken.wav");
    await fs.outputFile(brokenWav, Buffer.alloc(50));
    await createProvisionalTranscription({
      sessionId: "s1",
      audioFile: brokenWav,
    });

    const custodyAdapter = createStorageAdapter((fact) => facts.push(fact), {
      awaitCustodySettled: async () => ({
        audioFile: brokenWav,
        wavOk: false,
      }),
    });
    custodyAdapter.commit("s1", { kind: "success", text: "kept text" });
    await vi.waitFor(async () => {
      expect((await rowFor("s1"))?.disposition).toBe("success");
    });

    const row = await rowFor("s1");
    expect(row?.audio_file).toBeNull();
    expect(row?.text).toBe("kept text");
    expect(await fs.pathExists(brokenWav)).toBe(false);
  });

  it("a retained outcome with no row inserts its terminal row (§3.4)", async () => {
    const custodyAdapter = createStorageAdapter((fact) => facts.push(fact), {
      awaitCustodySettled: async () => ({
        audioFile: "/audio/kept.wav",
        wavOk: true,
      }),
    });

    // Provisional insert never happened (or custody never opened): the
    // pasted transcript must still land in history, audio attached.
    custodyAdapter.commit("s1", { kind: "success", text: "rescued" });
    await vi.waitFor(async () => {
      expect((await rowFor("s1"))?.disposition).toBe("success");
    });
    const row = await rowFor("s1");
    expect(row?.text).toBe("rescued");
    expect(row?.audio_file).toBe("/audio/kept.wav");

    // Existence guard: a commit retry after settling never duplicates.
    custodyAdapter.commit("s1", { kind: "success", text: "rescued" });
    await new Promise((r) => setTimeout(r, 5));
    const rows = testDb.db.all<Record<string, unknown>>(
      sql`SELECT id FROM transcriptions WHERE session_id = 's1'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("provisional rows are invisible to every user-facing surface", async () => {
    await createProvisionalTranscription({
      sessionId: "live",
      audioFile: "/audio/live.wav",
    });
    await createProvisionalTranscription({ sessionId: "done" });
    await stampTranscriptionDisposition("done", {
      disposition: "success",
      text: "hello",
    });

    expect((await getTranscriptions()).map((r) => r.sessionId)).toEqual([
      "done",
    ]);
    expect(await getTranscriptionsCount()).toBe(1);
    expect((await getLatestTranscription())?.sessionId).toBe("done");

    // Delete-all never touches live custody: the provisional row (and its
    // WAV path) survive for the lifecycle and the recovery sweep.
    const deleted = await deleteAllTranscriptions();
    expect(deleted).toHaveLength(1);
    expect(
      (await getUncommittedTranscriptions()).map((r) => r.sessionId),
    ).toEqual(["live"]);
  });

  it("by-id surfaces cannot see or touch provisional rows", async () => {
    await createProvisionalTranscription({
      sessionId: "live",
      audioFile: "/audio/live.wav",
    });
    const row = await rowFor("live");
    const id = row!.id as number;

    expect(await getTranscriptionById(id)).toBeNull();
    expect(await updateTranscription(id, { text: "smuggled" })).toBeNull();
    expect(await deleteTranscription(id)).toBeNull();

    // The custody row is untouched and still recoverable.
    const uncommitted = await getUncommittedTranscriptions();
    expect(uncommitted.map((r) => r.sessionId)).toEqual(["live"]);
    expect(uncommitted[0]?.text).toBe("");

    // Once stamped, the same id is visible and mutable.
    await stampTranscriptionDisposition("live", { disposition: "success" });
    expect((await getTranscriptionById(id))?.sessionId).toBe("live");
    expect(await deleteTranscription(id)).not.toBeNull();
  });
});
