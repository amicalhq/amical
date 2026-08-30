import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc } from "drizzle-orm";
import {
  snippets,
  syncItemState,
  syncOutbox,
  vocabulary,
} from "../../src/db/schema";
import { getAppSettings } from "../../src/db/app-settings";
import { runDataMigrations } from "../../src/main/migrations/data-migrations";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

describe("settings sync bounds data migration", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    await getAppSettings();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.close();
  });

  it("trims keys, drops out-of-bounds rows, and keeps the lowest-id key", async () => {
    const vocabularyCollision = "v".repeat(60);
    const snippetCollision = "s".repeat(60);
    const vocabularyIds = [
      "00000001-0000-4000-8000-000000000001",
      "00000002-0000-4000-8000-000000000002",
      "00000003-0000-4000-8000-000000000003",
      "00000004-0000-4000-8000-000000000004",
      "00000005-0000-4000-8000-000000000005",
      "00000006-0000-4000-8000-000000000006",
    ];
    const snippetIds = [
      "00000001-0000-4000-9000-000000000001",
      "00000002-0000-4000-9000-000000000002",
      "00000003-0000-4000-9000-000000000003",
      "00000004-0000-4000-9000-000000000004",
      "00000005-0000-4000-9000-000000000005",
      "00000006-0000-4000-9000-000000000006",
      "00000007-0000-4000-9000-000000000007",
    ];

    await testDb.db.insert(vocabulary).values([
      {
        id: vocabularyIds[0],
        word: `  ${vocabularyCollision}  `,
        replacementWord: "r".repeat(4000),
      },
      {
        id: vocabularyIds[1],
        word: vocabularyCollision,
      },
      {
        id: vocabularyIds[2],
        word: " \0\t ",
      },
      {
        id: vocabularyIds[3],
        word: "  keep  ",
        replacementWord: "keep",
      },
      {
        id: vocabularyIds[4],
        word: "v".repeat(61),
      },
      {
        id: vocabularyIds[5],
        word: "overlong-replacement",
        replacementWord: "r".repeat(4001),
      },
    ]);
    await testDb.db.insert(snippets).values([
      {
        id: snippetIds[0],
        trigger: `  ${snippetCollision}  `,
        content: "c".repeat(4000),
      },
      {
        id: snippetIds[1],
        trigger: snippetCollision,
        content: "duplicate loser",
      },
      {
        id: snippetIds[2],
        trigger: "\0 \t ",
        content: "invalid key",
      },
      {
        id: snippetIds[3],
        trigger: "  keep  ",
        content: "keep",
      },
      {
        id: snippetIds[4],
        trigger: "empty-content",
        content: "",
      },
      {
        id: snippetIds[5],
        trigger: "s".repeat(61),
        content: "overlong key",
      },
      {
        id: snippetIds[6],
        trigger: "overlong-content",
        content: "c".repeat(4001),
      },
    ]);

    await runDataMigrations();

    const migratedVocabulary = await testDb.db
      .select()
      .from(vocabulary)
      .orderBy(asc(vocabulary.id));
    const migratedSnippets = await testDb.db
      .select()
      .from(snippets)
      .orderBy(asc(snippets.id));

    expect(
      migratedVocabulary.map((row) => ({
        id: row.id,
        word: row.word,
        replacementWord: row.replacementWord,
      })),
    ).toEqual([
      {
        id: vocabularyIds[0],
        word: vocabularyCollision,
        replacementWord: "r".repeat(4000),
      },
      {
        id: vocabularyIds[3],
        word: "keep",
        replacementWord: "keep",
      },
    ]);
    expect(
      migratedSnippets.map((row) => ({
        id: row.id,
        trigger: row.trigger,
        content: row.content,
      })),
    ).toEqual([
      {
        id: snippetIds[0],
        trigger: snippetCollision,
        content: "c".repeat(4000),
      },
      {
        id: snippetIds[3],
        trigger: "keep",
        content: "keep",
      },
    ]);

    const settings = await getAppSettings();
    expect(settings.dataMigrations?.settingsSyncBounds).toBe(1);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);

    await testDb.db.insert(vocabulary).values({
      word: "z".repeat(61),
    });
    await runDataMigrations();

    const rerunRows = await testDb.db.select().from(vocabulary);
    expect(rerunRows.some((row) => row.word === "z".repeat(61))).toBe(true);
  });

  it("propagates prerequisite failures without writing its marker", async () => {
    const failure = new Error("bounds migration failed");
    vi.spyOn(testDb.db, "transaction").mockRejectedValueOnce(failure);

    await expect(runDataMigrations()).rejects.toBe(failure);

    const settings = await getAppSettings();
    expect(settings.dataMigrations?.settingsSyncBounds).toBeUndefined();
  });

  it("keeps equal normalized keys in separate scopes", async () => {
    const sharedVocabularyId = "10000000-0000-4000-8000-000000000001";
    const sharedSnippetId = "20000000-0000-4000-8000-000000000001";
    await testDb.db.insert(vocabulary).values([
      {
        id: sharedVocabularyId,
        word: "  shared  ",
        scopeType: "user",
        scopeId: "",
      },
      {
        id: sharedVocabularyId,
        word: "shared",
        scopeType: "org",
        scopeId: "org-1",
      },
    ]);
    await testDb.db.insert(snippets).values([
      {
        id: sharedSnippetId,
        trigger: "  /shared  ",
        content: "Personal",
        scopeType: "user",
        scopeId: "",
      },
      {
        id: sharedSnippetId,
        trigger: "/shared",
        content: "Organization",
        scopeType: "org",
        scopeId: "org-1",
      },
    ]);

    await runDataMigrations();

    expect(
      (await testDb.db.select().from(vocabulary)).map((row) => ({
        id: row.id,
        word: row.word,
      })),
    ).toEqual([
      { id: sharedVocabularyId, word: "shared" },
      { id: sharedVocabularyId, word: "shared" },
    ]);
    expect(
      (await testDb.db.select().from(snippets)).map((row) => ({
        id: row.id,
        trigger: row.trigger,
      })),
    ).toEqual([
      { id: sharedSnippetId, trigger: "/shared" },
      { id: sharedSnippetId, trigger: "/shared" },
    ]);
  });
});
