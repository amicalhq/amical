import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { migrateDatabase } from "@/db/migrate";
import {
  vocabulary,
  snippets,
  syncOutbox,
  syncClientState,
  syncCollectionState,
} from "@/db/schema";
import {
  beginUserSyncSession,
  adoptVisibleRows,
  capturePushHeads,
  applyPushResults,
  pauseSyncSession,
} from "@/db/sync";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

const migrations = join(process.cwd(), "src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrations, "meta/_journal.json"), "utf8"),
);
const WORD = "11111111-1111-4111-8111-111111111111";
const SNIPPET = "22222222-2222-4222-8222-222222222222";
const DELETED = "33333333-3333-4333-8333-333333333333";
const LOCAL = "44444444-4444-4444-8444-444444444444";
const PREFIXED = "voc_abcdefghijklmnopqrstuvwx";
let testDb: TestDatabase;
let folder: string;

function copyMigrations(lastIndex: number) {
  const entries = journal.entries.slice(0, lastIndex + 1);
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries)
    writeFileSync(
      join(folder, `${entry.tag}.sql`),
      readFileSync(join(migrations, `${entry.tag}.sql`)),
    );
}

beforeEach(async () => {
  pauseSyncSession();
  testDb = await createTestDatabase({ skipMigrations: true });
  setTestDatabase(testDb.db);
  folder = mkdtempSync(join(tmpdir(), "amical-settings-ids-"));
  mkdirSync(join(folder, "meta"));
  copyMigrations(11);
  migrateDatabase(testDb.db, { migrationsFolder: folder });
  const db = testDb.db;
  db.insert(vocabulary)
    .values([
      {
        id: WORD,
        word: "Word",
        replacementWord: "Local edit",
        usageCount: 7,
        createdAt: new Date(1000000),
        updatedAt: new Date(2000000),
      },
      {
        id: WORD,
        scopeType: "org",
        scopeId: "org-1",
        word: "Word",
        replacementWord: "Org edit",
      },
      { id: LOCAL, word: "Never synced" },
      { id: PREFIXED, word: "Already converted" },
    ])
    .run();
  db.insert(snippets)
    .values({ id: SNIPPET, trigger: "sig", content: "Regards" })
    .run();
  db.$client
    .prepare("INSERT INTO notes (id, title) VALUES (?, ?)")
    .run(WORD, "Unaffected note");
  db.insert(syncClientState)
    .values({ id: 1, lastOutboxSequence: 10 })
    .onConflictDoUpdate({
      target: syncClientState.id,
      set: { lastOutboxSequence: 10 },
    })
    .run();
  // Seed the historical schema before the notes columns exist.
  for (const row of [
    {
      scopeType: "user",
      scopeId: "alice",
      collection: "vocabulary",
      syncId: WORD,
      acceptedSyncVersion: 5,
      acceptedPayload: { word: "Word", replacement: "Old text" },
    },
    {
      scopeType: "org",
      scopeId: "org-1",
      collection: "vocabulary",
      syncId: WORD,
      acceptedSyncVersion: 6,
      acceptedPayload: { word: "Word", replacement: "Old org" },
    },
    {
      scopeType: "user",
      scopeId: "alice",
      collection: "snippet",
      syncId: SNIPPET,
      acceptedSyncVersion: 7,
      acceptedPayload: { trigger: "sig", content: "Regards" },
    },
    {
      scopeType: "user",
      scopeId: "alice",
      collection: "snippet",
      syncId: DELETED,
      acceptedSyncVersion: 8,
      acceptedPayload: { trigger: "deleted", content: "Gone" },
    },
  ]) {
    db.$client
      .prepare(
        `INSERT INTO sync_item_state
      (scope_type, scope_id, collection, sync_id, accepted_sync_version, accepted_payload)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.scopeType,
        row.scopeId,
        row.collection,
        row.syncId,
        row.acceptedSyncVersion,
        JSON.stringify(row.acceptedPayload),
      );
  }
  db.$client
    .prepare(
      `INSERT INTO sync_outbox (
    scope_type, scope_id, collection, sync_id, desired_payload,
    desired_base_sync_version, desired_sequence, head_present,
    head_sequence, head_expected_sync_version, head_payload, desired_parent_head_sequence
  ) VALUES ('user', 'alice', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      "vocabulary",
      WORD,
      JSON.stringify({ word: "Word", replacement: "Local edit" }),
      5,
      10,
      9,
      5,
      JSON.stringify({ word: "Word", replacement: "In flight" }),
      9,
    );
  db.$client
    .prepare(
      `INSERT INTO sync_outbox (
    scope_type, scope_id, collection, sync_id, desired_payload,
    desired_base_sync_version, desired_sequence, head_present, head_sequence, head_expected_sync_version
  ) VALUES ('user', 'alice', 'snippet', ?, NULL, 8, 8, 1, 8, 8)`,
    )
    .run(DELETED);
});
afterEach(async () => {
  pauseSyncSession();
  await testDb.close();
  rmSync(folder, { recursive: true, force: true });
});

it("clears settings sync including pending deletions, then rekeys IDs without changing content", () => {
  const db = testDb.db;
  const oldWords = db.select().from(vocabulary).all();
  const oldSnippet = db.select().from(snippets).get()!;
  const oldNotes = db.$client.prepare("SELECT id, title FROM notes").all();
  db.insert(syncCollectionState)
    .values({
      scopeType: "user",
      scopeId: "alice",
      collection: "vocabulary",
      cursor: 100,
    })
    .run();
  migrateDatabase(db, { migrationsFolder: migrations });
  const words = db.select().from(vocabulary).all();
  expect(new Set(words.map((row) => row.id)).size).toBe(4);
  for (const old of oldWords) {
    const row = words.find(
      (row) => row.word === old.word && row.scopeType === old.scopeType,
    )!;
    expect(row).toEqual({
      ...old,
      id: expect.stringMatching(/^voc_[a-z][a-z0-9]{23}$/),
    });
  }
  expect(words.find((row) => row.word === "Already converted")!.id).toBe(
    PREFIXED,
  );
  expect(db.select().from(snippets).get()).toEqual({
    ...oldSnippet,
    id: expect.stringMatching(/^snp_[a-z][a-z0-9]{23}$/),
  });
  expect(db.$client.prepare("SELECT id, title FROM notes").all()).toEqual(
    oldNotes,
  );
  expect(db.select().from(syncOutbox).all()).toEqual([]);
  expect(db.$client.prepare("SELECT * FROM sync_item_state").all()).toEqual([]);
  expect(db.select().from(syncCollectionState).all()).toEqual([]);
  expect(db.select().from(syncClientState).get()!.lastOutboxSequence).toBe(10);
});

it("lets server dedup restore the UUID without migrating it again on the next launch", async () => {
  migrateDatabase(testDb.db, { migrationsFolder: migrations });
  const fence = await beginUserSyncSession("alice");
  await adoptVisibleRows(fence);
  const heads = await capturePushHeads(fence);
  const id = testDb.db
    .select()
    .from(vocabulary)
    .all()
    .find((row) => row.word === "Word" && row.scopeType === "user")!.id;
  const head = heads.find((row) => row.syncId === id)!;
  expect(head.headExpectedSyncVersion).toBeNull();
  await applyPushResults(
    fence,
    [head],
    [
      {
        status: "conflict",
        reason: "duplicate_key_conflict",
        syncId: head.syncId,
        canonical: null,
        conflictingItem: {
          collection: "vocabulary",
          syncId: WORD,
          syncVersion: 5,
          payload: { word: "Word", replacement: "Old text" },
        },
      },
    ],
  );
  const personal = () =>
    testDb.db
      .select()
      .from(vocabulary)
      .all()
      .filter((row) => row.scopeType === "user" && row.word === "Word");
  expect(personal()).toMatchObject([{ id: WORD, replacementWord: "Old text" }]);
  migrateDatabase(testDb.db, { migrationsFolder: migrations });
  expect(personal()).toMatchObject([{ id: WORD, replacementWord: "Old text" }]);
  expect(
    testDb.db
      .select()
      .from(syncOutbox)
      .all()
      .some((row) => row.syncId === head.syncId),
  ).toBe(false);
});

it("rolls back IDs, outbox heads and versions together on migration failure", () => {
  const db = testDb.db;
  const before = {
    words: db.select().from(vocabulary).all(),
    items: db.$client.prepare("SELECT * FROM sync_item_state").all(),
    outbox: db.$client.prepare("SELECT * FROM sync_outbox").all(),
    client: db.select().from(syncClientState).all(),
  };
  copyMigrations(14);
  writeFileSync(
    join(folder, "0012_settings_ids.sql"),
    readFileSync(join(folder, "0012_settings_ids.sql"), "utf8") +
      "\n--> statement-breakpoint\nSELECT * FROM missing_table;",
  );
  expect(() => migrateDatabase(db, { migrationsFolder: folder })).toThrow();
  expect({
    words: db.select().from(vocabulary).all(),
    items: db.$client.prepare("SELECT * FROM sync_item_state").all(),
    outbox: db.$client.prepare("SELECT * FROM sync_outbox").all(),
    client: db.select().from(syncClientState).all(),
  }).toEqual(before);
  migrateDatabase(db, { migrationsFolder: migrations });
  expect(
    db
      .select()
      .from(vocabulary)
      .all()
      .every((row) => row.id.startsWith("voc_")),
  ).toBe(true);
});
