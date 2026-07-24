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

  it("repairs bounds and keeps the lowest-id key after clipping", async () => {
    const vocabularyCollision = "v".repeat(60);
    const snippetCollision = "s".repeat(60);

    await testDb.db.insert(vocabulary).values([
      {
        word: `${vocabularyCollision} first`,
        isReplacement: true,
        replacementWord: `${"r".repeat(3999)}😀tail`,
      },
      {
        word: vocabularyCollision,
        isReplacement: false,
      },
      {
        word: " \0\t ",
        isReplacement: false,
      },
      {
        word: "keep\0word",
        isReplacement: true,
        replacementWord: "keep\0replacement",
      },
    ]);
    await testDb.db.insert(snippets).values([
      {
        trigger: `${snippetCollision} first`,
        content: `${"c".repeat(3999)}😀tail`,
      },
      {
        trigger: snippetCollision,
        content: "duplicate loser",
      },
      {
        trigger: "\0 \t ",
        content: "invalid key",
      },
      {
        trigger: "keep\0trigger",
        content: "keep\0content",
      },
      {
        trigger: "empty-content",
        content: "",
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
        id: 1,
        word: vocabularyCollision,
        replacementWord: "r".repeat(3999),
      },
      {
        id: 4,
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
        id: 1,
        trigger: snippetCollision,
        content: "c".repeat(3999),
      },
      {
        id: 4,
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
      isReplacement: false,
    });
    await runDataMigrations();

    const rerunRows = await testDb.db
      .select()
      .from(vocabulary)
      .orderBy(asc(vocabulary.id));
    expect(rerunRows.at(-1)?.word).toBe("z".repeat(61));
  });

  it("propagates prerequisite failures without writing its marker", async () => {
    const failure = new Error("bounds migration failed");
    vi.spyOn(testDb.db, "transaction").mockRejectedValueOnce(failure);

    await expect(runDataMigrations()).rejects.toBe(failure);

    const settings = await getAppSettings();
    expect(settings.dataMigrations?.settingsSyncBounds).toBeUndefined();
  });
});
