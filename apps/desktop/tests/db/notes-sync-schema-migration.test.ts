import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase } from "@/db/migrate";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as Y from "yjs";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { loadNoteBody } from "@/db/note-body";
import { notes, yjsUpdates, vocabulary, snippets } from "@/db/schema";

const migrations = join(process.cwd(), "src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrations, "meta/_journal.json"), "utf8"),
);
const NOTE_ID = /^nt_[a-z][a-z0-9]{23}$/;
let testDb: TestDatabase;
let folder: string;
let update: Buffer;

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
  testDb = await createTestDatabase({ skipMigrations: true });
  setTestDatabase(testDb.db);
  folder = mkdtempSync(join(tmpdir(), "amical-note-migration-"));
  mkdirSync(join(folder, "meta"));
  copyMigrations(10);
  migrateDatabase(testDb.db, { migrationsFolder: folder });
  testDb.db
    .insert(vocabulary)
    .values({
      id: "11111111-1111-4111-8111-111111111111",
      word: "Existing word",
    })
    .run();
  testDb.db
    .insert(snippets)
    .values({
      id: "22222222-2222-4222-8222-222222222222",
      trigger: "existing",
      content: "Existing content",
    })
    .run();
  const doc = new Y.Doc();
  doc.getText("content").insert(
    0,
    JSON.stringify({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Preserved body", format: 0 }],
          },
        ],
      },
    }),
  );
  update = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  testDb.db.$client
    .prepare(
      "INSERT INTO notes (id, title, content, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(42, "Existing", "stale SQL body", "🌻", 1000, 2000);
  testDb.db.$client
    .prepare(
      "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(43, "Other note", "", 3000, 4000);
  testDb.db.$client
    .prepare(
      "INSERT INTO yjs_updates (id, note_id, update_data, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(7, 42, update, 1234);
});
afterEach(async () => {
  await testDb.close();
  rmSync(folder, { recursive: true, force: true });
});

it("upgrades integer IDs before Markdown, retaining Yjs data and its foreign keys", () => {
  const oldVocabulary = testDb.db.select().from(vocabulary).all();
  const oldSnippets = testDb.db.select().from(snippets).all();
  migrateDatabase(testDb.db, { migrationsFolder: migrations });
  expect(testDb.db.select().from(vocabulary).all()).toEqual(
    oldVocabulary.map((row) => ({
      ...row,
      id: expect.stringMatching(/^voc_[a-z][a-z0-9]{23}$/),
    })),
  );
  expect(testDb.db.select().from(snippets).all()).toEqual(
    oldSnippets.map((row) => ({
      ...row,
      id: expect.stringMatching(/^snp_[a-z][a-z0-9]{23}$/),
    })),
  );
  const newWord = testDb.db
    .insert(vocabulary)
    .values({ word: "New word" })
    .returning()
    .get();
  const newSnippet = testDb.db
    .insert(snippets)
    .values({ trigger: "new", content: "New content" })
    .returning()
    .get();
  expect(newWord.id).toMatch(/^voc_[a-z][a-z0-9]{23}$/);
  expect(newSnippet.id).toMatch(/^snp_[a-z][a-z0-9]{23}$/);
  const rows = testDb.db.select().from(notes).all();
  const note = rows.find((row) => row.title === "Existing")!;
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.id).toMatch(NOTE_ID);
  expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  expect(note).toMatchObject({
    content: "stale SQL body",
    icon: "🌻",
    createdAt: new Date(1000000),
    updatedAt: new Date(2000000),
    contentFormat: "legacy",
  });
  expect(note).not.toHaveProperty("syncId");
  const recovery = testDb.db.select().from(yjsUpdates).get()!;
  expect(recovery).toMatchObject({
    id: 7,
    noteId: note.id,
    updateData: update,
    createdAt: new Date(1234000),
  });
  expect(testDb.db.$client.prepare("PRAGMA foreign_key_check").all()).toEqual(
    [],
  );
  expect(loadNoteBody(note.id)).toMatchObject({
    status: "ready",
    markdown: "Preserved body\n",
  });
  expect(testDb.db.select().from(yjsUpdates).get()).toEqual(recovery);
  const converted = testDb.db.select().from(notes).all();
  migrateDatabase(testDb.db, { migrationsFolder: migrations });
  expect(testDb.db.select().from(notes).all()).toEqual(converted);
  expect(
    testDb.db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE '__note%' OR name LIKE '__saved_yjs%'",
      )
      .all(),
  ).toEqual([]);
  testDb.db.$client.prepare("DELETE FROM notes WHERE id = ?").run(note.id);
  expect(testDb.db.select().from(yjsUpdates).all()).toEqual([]);
});

it("rolls back ID remapping and recovery rows if a later pending migration fails", () => {
  copyMigrations(13);
  writeFileSync(
    join(folder, "0013_notes_markdown.sql"),
    readFileSync(join(folder, "0013_notes_markdown.sql"), "utf8") +
      "\n--> statement-breakpoint\nSELECT * FROM missing_migration_table;",
  );
  expect(() =>
    migrateDatabase(testDb.db, { migrationsFolder: folder }),
  ).toThrow();
  expect(
    testDb.db.$client
      .prepare("SELECT id, content FROM notes ORDER BY id")
      .all(),
  ).toEqual([
    { id: 42, content: "stale SQL body" },
    { id: 43, content: "" },
  ]);
  expect(
    testDb.db.$client
      .prepare("SELECT id, note_id, update_data FROM yjs_updates")
      .get(),
  ).toEqual({ id: 7, note_id: 42, update_data: update });
  expect(
    testDb.db.$client
      .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
      .get(),
  ).toEqual({ count: 11 });
  migrateDatabase(testDb.db, { migrationsFolder: migrations });
  expect(
    testDb.db
      .select()
      .from(notes)
      .all()
      .every((note) => NOTE_ID.test(note.id)),
  ).toBe(true);
});
