import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { notes, yjsUpdates } from "./schema";
import { convertLegacyNote } from "../notes/legacy";
import type { NoteBody, NoteSaveResult } from "../notes/types";

function updatesFor(noteId: number) {
  return db
    .select()
    .from(yjsUpdates)
    .where(eq(yjsUpdates.noteId, noteId))
    .orderBy(asc(yjsUpdates.id))
    .all()
    .map((row) => new Uint8Array(row.updateData));
}

// One synchronous transaction per note: a crash can leave either the complete
// legacy note or the complete Markdown note, never a partially migrated body.
function migrateNote(noteId: number, allowPlainTextYjs = false): void {
  db.transaction((tx) => {
    const note = tx.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!note || !["legacy", "blocked"].includes(note.contentFormat)) return;
    try {
      const content = convertLegacyNote(
        updatesFor(noteId),
        note.content,
        allowPlainTextYjs,
      );
      tx.update(notes)
        .set({
          content,
          contentFormat: "markdown-v1",
          legacyContent: note.content,
          migrationError: null,
        })
        .where(eq(notes.id, noteId))
        .run();
    } catch (error) {
      tx.update(notes)
        .set({
          contentFormat: "blocked",
          legacyContent: note.content,
          migrationError:
            error instanceof Error
              ? error.message
              : "Cannot convert legacy note",
        })
        .where(eq(notes.id, noteId))
        .run();
    }
  });
}

export function migrateLegacyNotes(allowPlainTextYjs = false): void {
  const pending = db
    .select({ id: notes.id })
    .from(notes)
    .where(inArray(notes.contentFormat, ["legacy", "blocked"]))
    .all();
  for (const note of pending) migrateNote(note.id, allowPlainTextYjs);
}

export function loadNoteBody(noteId: number): NoteBody {
  migrateNote(noteId);
  const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return { status: "deleted", noteId };
  if (note.contentFormat === "markdown-v1")
    return {
      status: "ready",
      noteId,
      markdown: note.content ?? "",
    };
  return {
    status: "blocked",
    noteId,
    reason: note.migrationError ?? "Unknown note format",
  };
}

export function saveNoteBody(noteId: number, markdown: string): NoteSaveResult {
  return db.transaction((tx) => {
    const note = tx.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!note) return { status: "deleted" };
    if (note.contentFormat !== "markdown-v1")
      throw new Error("This note needs recovery before editing");
    if (note.content === markdown) return { status: "saved" };
    tx.update(notes)
      .set({ content: markdown, updatedAt: new Date() })
      .where(eq(notes.id, noteId))
      .run();
    return { status: "saved" };
  });
}
