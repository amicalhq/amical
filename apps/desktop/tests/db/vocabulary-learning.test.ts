import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { syncOutbox, vocabulary } from "../../src/db/schema";
import { beginUserSyncSession, pauseSyncSession } from "../../src/db/sync";
import {
  createProvisionalTranscription,
  getTranscriptionBySessionId,
  stampTranscriptionDisposition,
} from "../../src/db/transcriptions";
import {
  createVocabularyWord,
  insertLearnedVocabulary,
  undoLearnedVocabulary,
  updateVocabulary,
} from "../../src/db/vocabulary";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

type DesktopDatabase = typeof import("../../src/db").db;

describe("learned vocabulary storage", () => {
  let testDb: TestDatabase;
  let database: DesktopDatabase;

  beforeEach(async () => {
    pauseSyncSession();
    testDb = await createTestDatabase();
    database = testDb.db as unknown as DesktopDatabase;
    setTestDatabase(database);
    await beginUserSyncSession("user-1", database);
  });

  afterEach(async () => {
    pauseSyncSession();
    await testDb.close();
  });

  it("inserts learned rows as personal auto rows and skips known words case-insensitively", async () => {
    await createVocabularyWord({ word: "claude code" });
    await createVocabularyWord({ word: "k8s", replacementWord: "Kubernetes" });

    const created = await insertLearnedVocabulary([
      { word: "Claude Code", observedSource: "cloud code" },
      { word: "kubernetes", observedSource: "cube netties" },
      { word: "Priya", observedSource: "pria" },
      { word: "priya", observedSource: "pria" },
    ]);

    expect(created.map((row) => row.word)).toEqual(["Priya"]);
    expect(created[0]).toMatchObject({
      scopeType: "user",
      scopeId: "",
      source: "auto",
      observedSource: "pria",
      replacementWord: null,
    });
    expect(
      database
        .select()
        .from(syncOutbox)
        .where(eq(syncOutbox.syncId, created[0].id))
        .all(),
    ).toEqual([
      expect.objectContaining({
        collection: "vocabulary",
        desiredPayload: { word: "Priya", replacement: null },
      }),
    ]);
  });

  it("undoes only rows that still are the inserted auto word, also after updatedAt was rewritten", async () => {
    const [kept, edited, renamed] = await insertLearnedVocabulary([
      { word: "Kubeflow", observedSource: "cube flow" },
      { word: "Jon", observedSource: "john" },
      { word: "Amical", observedSource: "a miracle" },
    ]);
    // The sync push acknowledgement rewrites updatedAt about 1 s after the
    // insert; Undo must not guard on it.
    database
      .update(vocabulary)
      .set({ updatedAt: new Date(Date.now() + 1_500) })
      .where(eq(vocabulary.id, kept.id))
      .run();
    // Editing a learned row makes it manual; a renamed row no longer matches.
    await updateVocabulary(edited.id, { replacementWord: "Jonathan" });
    await updateVocabulary(renamed.id, { word: "Amical AI" });

    const removed = await undoLearnedVocabulary([
      { id: kept.id, word: "Kubeflow" },
      { id: edited.id, word: "Jon" },
      { id: renamed.id, word: "Amical" },
    ]);

    expect(removed.map((row) => row.id)).toEqual([kept.id]);
    const remaining = database.select().from(vocabulary).all();
    expect(remaining).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: edited.id, source: "manual" }),
        expect.objectContaining({ id: renamed.id, word: "Amical AI" }),
      ]),
    );
    expect(remaining).toHaveLength(2);
    expect(
      database
        .select()
        .from(syncOutbox)
        .where(eq(syncOutbox.syncId, kept.id))
        .all(),
    ).toEqual([expect.objectContaining({ desiredPayload: null })]);
  });
});

describe("getTranscriptionBySessionId", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("returns the committed row only", async () => {
    await createProvisionalTranscription({ sessionId: "s1" });
    expect(await getTranscriptionBySessionId("s1")).toBeNull();

    await stampTranscriptionDisposition("s1", {
      disposition: "success",
      text: "open cloud code",
    });
    expect(await getTranscriptionBySessionId("s1")).toMatchObject({
      sessionId: "s1",
      disposition: "success",
    });
    expect(await getTranscriptionBySessionId("other")).toBeNull();
  });
});
