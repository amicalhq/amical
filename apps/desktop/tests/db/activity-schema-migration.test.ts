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

  it("adds exact audio duration, the device outbox, and its source cursor", () => {
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
      "transcription_cursor",
    ]);
    expect(
      materializationColumns.find((column) => column.name === "id")?.pk,
    ).toBe(1);
  });
});
