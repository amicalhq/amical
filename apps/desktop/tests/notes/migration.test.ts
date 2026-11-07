import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { notes, yjsUpdates } from "@/db/schema";
import { loadNoteBody, migrateLegacyNotes, saveNoteBody } from "@/db/note-body";

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  setTestDatabase(database.db);
});
afterEach(async () => {
  await database.close();
});
const document = (text: string, format = 0) =>
  JSON.stringify({
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text, format }] },
      ],
    },
  });
function legacy(
  content = "stale column",
  formats = [document("old"), document("new 👋")],
) {
  const note = database.db
    .insert(notes)
    .values({
      title: "Original",
      content,
      icon: "🌻",
      createdAt: new Date(1000000),
      updatedAt: new Date(2000000),
    })
    .returning()
    .get();
  const doc = new Y.Doc();
  doc.on("update", (update: Uint8Array) =>
    database.db
      .insert(yjsUpdates)
      .values({ noteId: note.id, updateData: Buffer.from(update) })
      .run(),
  );
  for (const value of formats)
    doc.transact(() => {
      doc.getText("content").delete(0, doc.getText("content").length);
      doc.getText("content").insert(0, value);
    });
  doc.destroy();
  return note;
}

describe("legacy Markdown migration", () => {
  it("replays all updates, keeps metadata and backups, and is idempotent", () => {
    const original = legacy();
    const blobs = database.db.select().from(yjsUpdates).all();
    migrateLegacyNotes();
    const body = loadNoteBody(original.id);
    expect(body).toMatchObject({
      status: "ready",
      markdown: "new 👋\n",
    });
    const migrated = database.db.select().from(notes).get()!;
    expect(migrated).toMatchObject({
      id: original.id,
      title: original.title,
      icon: original.icon,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
      legacyContent: original.content,
    });
    migrateLegacyNotes();
    loadNoteBody(original.id);
    expect(database.db.select().from(notes).get()).toEqual(migrated);
    expect(database.db.select().from(yjsUpdates).all()).toEqual(blobs);
  });
  it("converts pre-Lexical plain Y.Text only with the old migration marker", () => {
    const plain = legacy("", ["literal **text**\nsecond line"]);
    migrateLegacyNotes(true);
    expect(loadNoteBody(plain.id)).toMatchObject({
      status: "ready",
      markdown: "literal \\*\\*text\\*\\*\n\nsecond line\n",
    });
  });
  it("resumes migration after restart and never overwrites an edited migrated note", async () => {
    const first = legacy(),
      second = legacy();
    loadNoteBody(first.id);
    saveNoteBody(first.id, "new edit");
    const path = database.dbPath;
    await database.close();
    const { createMockDb } = await import("../helpers/test-db");
    const db = createMockDb(path);
    database = {
      ...database,
      db,
      close: async () => {
        db.$client.close();
      },
    };
    setTestDatabase(db);
    migrateLegacyNotes();
    expect(loadNoteBody(first.id)).toMatchObject({
      markdown: "new edit",
    });
    expect(loadNoteBody(second.id)).toMatchObject({
      status: "ready",
      markdown: "new 👋\n",
    });
    expect(db.select().from(notes).all()).toHaveLength(2);
  });
  it("rolls the whole note back when the migration cannot commit", () => {
    const note = legacy();
    database.db.$client.exec(
      "CREATE TRIGGER fail_note_update BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT, 'test interruption'); END",
    );
    expect(() => migrateLegacyNotes()).toThrow();
    expect(database.db.select().from(notes).get()).toEqual(note);
    database.db.$client.exec("DROP TRIGGER fail_note_update");
    migrateLegacyNotes();
    expect(loadNoteBody(note.id)).toMatchObject({ status: "ready" });
  });

  it("uses a populated Lexical column only when no Yjs updates exist", () => {
    const source = document("column-only note");
    const note = legacy(source, []);
    migrateLegacyNotes();
    expect(loadNoteBody(note.id)).toMatchObject({
      status: "ready",
      markdown: "column-only note\n",
    });
    expect(database.db.select().from(notes).get()).toMatchObject({
      legacyContent: source,
    });
  });

  it("handles empty notes without treating stale content as the body", () => {
    const empty = legacy("", []);
    const withStaleColumn = legacy("stale", [document("")]);
    const missing = legacy("cannot infer this body's format", []);
    migrateLegacyNotes();
    expect(loadNoteBody(empty.id)).toMatchObject({
      status: "ready",
      markdown: "",
    });
    expect(loadNoteBody(withStaleColumn.id)).toMatchObject({
      status: "ready",
      markdown: "",
    });
    expect(loadNoteBody(missing.id)).toMatchObject({ status: "blocked" });
  });
  it("isolates malformed, unknown and incomplete content without erasing originals", () => {
    const malformed = legacy("original column", ["{bad JSON"]);
    const unsupported = legacy("original column", [
      JSON.stringify({
        root: {
          type: "root",
          children: [{ type: "image", src: "original.png" }],
        },
      }),
    ]);
    const incomplete = legacy();
    database.db.$client
      .prepare(
        "DELETE FROM yjs_updates WHERE note_id = ? AND id = (SELECT min(id) FROM yjs_updates WHERE note_id = ?)",
      )
      .run(incomplete.id, incomplete.id);
    const corrupt = legacy();
    database.db
      .insert(yjsUpdates)
      .values({ noteId: corrupt.id, updateData: Buffer.from([255]) })
      .run();
    const valid = legacy();
    const before = database.db.select().from(yjsUpdates).all();
    migrateLegacyNotes();
    migrateLegacyNotes();
    for (const note of [malformed, unsupported, incomplete, corrupt]) {
      expect(loadNoteBody(note.id)).toMatchObject({ status: "blocked" });
      expect(() => saveNoteBody(note.id, "overwrite")).toThrow();
    }
    expect(loadNoteBody(valid.id)).toMatchObject({ status: "ready" });
    expect(database.db.select().from(yjsUpdates).all()).toEqual(before);
  });
  it("migrates formerly blocked styling, retains originals and metadata, then accepts Markdown edits", () => {
    const original = legacy("original column", [document("underlined", 9)]);
    database.db.$client
      .prepare(
        "UPDATE notes SET content_format = 'blocked', legacy_content = content, migration_error = 'Unsupported note formatting: text format 9' WHERE id = ?",
      )
      .run(original.id);
    const blobs = database.db.select().from(yjsUpdates).all();
    migrateLegacyNotes();
    const migrated = database.db.select().from(notes).get()!;
    expect(migrated).toMatchObject({
      ...original,
      content: "**underlined**\n",
      contentFormat: "markdown-v1",
      legacyContent: "original column",
      migrationError: null,
    });
    expect(loadNoteBody(original.id)).toMatchObject({ status: "ready" });
    migrateLegacyNotes();
    expect(database.db.select().from(notes).get()).toEqual(migrated);
    expect(database.db.select().from(yjsUpdates).all()).toEqual(blobs);
    expect(saveNoteBody(original.id, "edited\n")).toMatchObject({
      status: "saved",
    });
    migrateLegacyNotes();
    expect(loadNoteBody(original.id)).toMatchObject({
      markdown: "edited\n",
    });
    expect(database.db.select().from(yjsUpdates).all()).toEqual(blobs);
  });
  it("keeps the last write, rejects deletion, and opening cannot normalize or retimestamp", () => {
    const note = legacy("", []);
    loadNoteBody(note.id);
    const saved = saveNoteBody(note.id, "**exact**\n\n");
    expect(saved).toMatchObject({ status: "saved" });
    expect(saveNoteBody(note.id, "last write\n\n")).toMatchObject({
      status: "saved",
    });
    expect(loadNoteBody(note.id)).toMatchObject({
      markdown: "last write\n\n",
    });
    migrateLegacyNotes();
    expect(loadNoteBody(note.id)).toMatchObject({
      markdown: "last write\n\n",
    });
    database.db.$client.prepare("DELETE FROM notes WHERE id = ?").run(note.id);
    expect(saveNoteBody(note.id, "revive")).toMatchObject({
      status: "deleted",
    });
    expect(database.db.select().from(notes).all()).toEqual([]);
  });
});
