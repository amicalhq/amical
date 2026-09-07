import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { notes, yjsUpdates } from "./schema";
import { convertLegacyNote } from "../notes/legacy";
import {
  visibleNotesWhere,
  recordNoteMutation,
  noteSyncPayload,
  preserveNoteConflict,
  findNoteSyncState,
} from "./settings-sync/notes";
import { findSidecar } from "./settings-sync/canonical";
import type { NoteBody, NoteSaveResult, NoteSaveOrigin } from "../notes/types";

function updatesFor(noteId: string) {
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
function migrateNote(noteId: string, allowPlainTextYjs = false): void {
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

export function loadNoteBody(noteId: string): NoteBody {
  if (
    !db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.id, noteId), visibleNotesWhere()))
      .get()
  )
    return { status: "deleted", noteId };
  migrateNote(noteId);
  const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return { status: "deleted", noteId };
  if (note.contentFormat === "markdown-v1") {
    const syncState = findNoteSyncState(db, note);
    if (note.accountId && !syncState) {
      db.transaction((tx) => recordNoteMutation(tx, note));
    }
    return {
      status: "ready",
      noteId,
      markdown: note.content ?? "",
      remoteVersion: syncState?.remoteVersion ?? null,
      ...(note.accountId
        ? {
            origin: {
              accountId: note.accountId,
              title: note.title,
              icon: note.icon,
              createdAtMs: note.createdAt.getTime(),
              markdown: note.content ?? "",
            },
          }
        : {}),
    };
  }
  return {
    status: "blocked",
    noteId,
    reason: note.migrationError ?? "Unknown note format",
  };
}

export function saveNoteBody(
  noteId: string,
  markdown: string,
  expectedRemoteVersion?: number | null,
  origin?: NoteSaveOrigin,
): NoteSaveResult {
  return db.transaction((tx) => {
    const note = tx.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!note) {
      // Only a newer accepted remote tombstone can recover a pending editor
      // draft. Local deletion and ordinary delayed saves never recreate notes.
      if (origin && expectedRemoteVersion !== undefined) {
        const fence = {
          accountId: origin.accountId,
          scopeId: origin.accountId,
          scopeType: "user" as const,
        };
        const sidecar = findSidecar(tx, fence, "note", noteId);
        if (
          sidecar?.acceptedPayload === null &&
          sidecar.noteRemoteVersion !== null &&
          sidecar.noteRemoteVersion > (expectedRemoteVersion ?? 0)
        ) {
          preserveNoteConflict(tx, fence, {
            schemaVersion: 1,
            title: origin.title,
            icon: origin.icon,
            body: { format: "markdown", content: markdown },
            createdAtMs: origin.createdAtMs,
            updatedAtMs: Date.now(),
          });
          return { status: "saved", recovered: true };
        }
      }
      return { status: "deleted" };
    }
    const fromOpenEditor = origin && note.accountId === origin.accountId;
    if (
      !fromOpenEditor &&
      !tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, noteId), visibleNotesWhere()))
        .get()
    )
      return { status: "deleted" };
    if (note.contentFormat !== "markdown-v1")
      throw new Error("This note needs recovery before editing");
    const remoteVersion = findNoteSyncState(tx, note)?.remoteVersion ?? null;
    const saved: NoteSaveResult = {
      status: "saved",
      ...(note.accountId ? { remoteVersion } : {}),
    };
    if (note.content === markdown) return saved;
    // A remote edit can arrive while an editor has an unsaved debounce. Keep
    // that remote version as a copy before the editor saves its own body.
    if (
      expectedRemoteVersion !== undefined &&
      expectedRemoteVersion !== remoteVersion &&
      (!origin || origin.markdown !== note.content) &&
      note.accountId
    ) {
      preserveNoteConflict(
        tx,
        {
          accountId: note.accountId,
          scopeId: note.accountId,
          scopeType: "user",
        },
        noteSyncPayload(note),
      );
    }
    const updated = tx
      .update(notes)
      .set({ content: markdown, updatedAt: new Date() })
      .where(eq(notes.id, noteId))
      .returning()
      .get()!;
    recordNoteMutation(tx, updated);
    return saved;
  });
}
