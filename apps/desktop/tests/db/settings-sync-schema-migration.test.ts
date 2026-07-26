import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { snippets, syncItemState, vocabulary } from "../../src/db/schema";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("settings sync schema migration", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ skipMigrations: true });
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("migrates legacy replacement state while replacing integer IDs with UUID sync IDs", async () => {
    await testDb.db.$client.executeMultiple(`
      CREATE TABLE vocabulary (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        word text NOT NULL,
        replacement_word text,
        is_replacement integer DEFAULT false,
        date_added integer DEFAULT (unixepoch()) NOT NULL,
        usage_count integer DEFAULT 0,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      );
      CREATE UNIQUE INDEX vocabulary_word_unique ON vocabulary (word);
      CREATE TABLE snippets (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        trigger text NOT NULL,
        content text NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      );
      CREATE UNIQUE INDEX snippets_trigger_unique ON snippets (trigger);
      INSERT INTO vocabulary (word, replacement_word, is_replacement, usage_count)
      VALUES ('Amical', 'Amical AI', 1, 3);
      INSERT INTO vocabulary (word, replacement_word, is_replacement, usage_count)
      VALUES ('Dormant', 'must be cleared', 0, 1);
      INSERT INTO snippets (trigger, content) VALUES ('sig', 'Regards');
    `);

    const migration = fs
      .readFileSync(
        path.join(
          process.cwd(),
          "src",
          "db",
          "migrations",
          "0007_odd_mastermind.sql",
        ),
        "utf8",
      )
      .replaceAll("--> statement-breakpoint", "");
    await testDb.db.$client.executeMultiple(migration);

    const vocabularyRows = await testDb.db.select().from(vocabulary);
    const vocabularyRow = vocabularyRows.find((row) => row.word === "Amical");
    const dormantVocabularyRow = vocabularyRows.find(
      (row) => row.word === "Dormant",
    );
    const [snippetRow] = await testDb.db.select().from(snippets);
    expect(vocabularyRow).toMatchObject({
      word: "Amical",
      replacementWord: "Amical AI",
      usageCount: 3,
    });
    expect(dormantVocabularyRow).toMatchObject({
      word: "Dormant",
      replacementWord: null,
      usageCount: 1,
    });
    expect(snippetRow).toMatchObject({
      trigger: "sig",
      content: "Regards",
    });
    expect(vocabularyRow?.id).toMatch(UUID_PATTERN);
    expect(dormantVocabularyRow?.id).toMatch(UUID_PATTERN);
    expect(snippetRow.id).toMatch(UUID_PATTERN);
    expect(vocabularyRow?.id.startsWith("00000001-")).toBe(true);
    expect(dormantVocabularyRow?.id.startsWith("00000002-")).toBe(true);
    expect(snippetRow.id.startsWith("00000001-")).toBe(true);

    const vocabularyColumns = await testDb.db.$client.execute(
      "PRAGMA table_info(vocabulary)",
    );
    expect(vocabularyColumns.rows.map((row) => row.name)).not.toContain(
      "is_replacement",
    );
    const syncColumns = await testDb.db.$client.execute(
      "PRAGMA table_info(sync_item_state)",
    );
    expect(syncColumns.rows.map((row) => row.name)).not.toContain(
      "local_row_id",
    );
    const expectedSyncPrimaryKeys = {
      sync_item_state: ["scope_type", "scope_id", "collection", "sync_id"],
      sync_outbox: ["scope_type", "scope_id", "collection", "sync_id"],
      sync_collection_state: ["scope_type", "scope_id", "collection"],
    };
    for (const [table, expectedPrimaryKey] of Object.entries(
      expectedSyncPrimaryKeys,
    )) {
      const columns = await testDb.db.$client.execute(
        `PRAGMA table_info(${table})`,
      );
      expect(columns.rows.map((row) => row.name)).not.toContain("account_id");
      expect(
        columns.rows
          .filter((row) => Number(row.pk) > 0)
          .sort((left, right) => Number(left.pk) - Number(right.pk))
          .map((row) => row.name),
      ).toEqual(expectedPrimaryKey);
    }
    const clientColumns = await testDb.db.$client.execute(
      "PRAGMA table_info(sync_client_state)",
    );
    expect(clientColumns.rows.map((row) => row.name)).toEqual([
      "id",
      "last_outbox_sequence",
    ]);
    const scopeTable = await testDb.db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_scope_state'",
    );
    expect(scopeTable.rows).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
  });
});
