import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

describe("activity reporting schema migration", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("adds exact audio duration, the device outbox, and pending flags", () => {
    const transcriptionColumns = testDb.db.$client
      .prepare<
        [],
        { name: string; pk: number; type: string }
      >("PRAGMA table_info(transcriptions)")
      .all();
    expect(transcriptionColumns.map((column) => column.name)).toContain(
      "audio_duration_ms",
    );
    expect(
      transcriptionColumns.find((column) => column.name === "activity_pending"),
    ).toMatchObject({ type: "INTEGER", notnull: 1, dflt_value: "true" });
    expect(
      transcriptionColumns.find((column) => column.name === "id"),
    ).toMatchObject({ pk: 1, type: "INTEGER" });
    expect(
      transcriptionColumns.find((column) => column.name === "session_id"),
    ).toMatchObject({ pk: 0, type: "TEXT" });

    const outboxColumns = testDb.db.$client
      .prepare<
        [],
        { name: string; pk: number }
      >("PRAGMA table_info(activity_outbox)")
      .all();
    expect(outboxColumns.map((column) => column.name)).toEqual([
      "activity_id",
      "payload",
      "created_at",
    ]);
    expect(
      outboxColumns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name),
    ).toEqual(["activity_id"]);

    const materializationColumns = testDb.db.$client
      .prepare<
        [],
        { name: string; pk: number }
      >("PRAGMA table_info(activity_materialization_state)")
      .all();
    expect(materializationColumns.map((column) => column.name)).toEqual([
      "id",
      "account_id",
    ]);
    expect(
      materializationColumns.find((column) => column.name === "id")?.pk,
    ).toBe(1);
  });

  it("preserves cursor progress and queued payloads while leaving unsettled rows pending", () => {
    const client = new Database(":memory:");
    try {
      client.exec(`
        CREATE TABLE transcriptions (
          id INTEGER PRIMARY KEY, session_id TEXT, disposition TEXT, created_at INTEGER
        );
        CREATE TABLE activity_materialization_state (
          id INTEGER PRIMARY KEY, account_id TEXT, transcription_cursor INTEGER NOT NULL DEFAULT 0,
          CHECK (id = 1), CHECK (transcription_cursor >= 0)
        );
        CREATE TABLE activity_outbox (activity_id TEXT PRIMARY KEY, payload TEXT, created_at INTEGER);
        INSERT INTO activity_materialization_state VALUES (1, 'existing-account', 3);
        INSERT INTO transcriptions VALUES
          (1, 'reported', 'success', 1),
          (2, 'still-recording', NULL, 2),
          (3, 'failed', 'failure', 3),
          (4, 'queued', 'success', 4),
          (5, 'unprocessed', 'success', 5);
        INSERT INTO activity_outbox VALUES ('queued', '{"immutable":true}', 4);
      `);
      const migration = readFileSync(
        join(process.cwd(), "src/db/migrations/0015_activity_pending.sql"),
        "utf8",
      );
      client.transaction(() => client.exec(migration))();

      expect(
        client
          .prepare(
            "SELECT id, activity_pending FROM transcriptions ORDER BY id",
          )
          .all(),
      ).toEqual([
        { id: 1, activity_pending: 0 },
        { id: 2, activity_pending: 1 },
        { id: 3, activity_pending: 0 },
        { id: 4, activity_pending: 0 },
        { id: 5, activity_pending: 1 },
      ]);
      expect(
        client.prepare("SELECT * FROM activity_materialization_state").all(),
      ).toEqual([{ id: 1, account_id: "existing-account" }]);
      expect(client.prepare("SELECT * FROM activity_outbox").all()).toEqual([
        { activity_id: "queued", payload: '{"immutable":true}', created_at: 4 },
      ]);
      client.exec(
        "INSERT INTO transcriptions (id, disposition) VALUES (6, 'success')",
      );
      expect(
        client
          .prepare("SELECT activity_pending FROM transcriptions WHERE id = 6")
          .get(),
      ).toEqual({ activity_pending: 1 });
    } finally {
      client.close();
    }
  });
});
