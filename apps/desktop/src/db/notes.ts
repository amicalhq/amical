import { eq, desc, asc, like, and } from "drizzle-orm";
import { db } from "./index";
import { notes, type Note, type NewNote } from "./schema";

import { activeUserIdentity } from "./settings-sync/active-state";
import {
  visibleNotesWhere,
  recordNoteMutation,
  findNoteSyncState,
  noteSyncPayload,
  preserveNoteConflict,
} from "./settings-sync/notes";

// Create a new note
export async function createNote(data: Pick<NewNote, "title" | "icon">) {
  const now = new Date();

  const newNote: NewNote = {
    ...data,
    accountId: activeUserIdentity()?.scopeId ?? null,
    content: "",
    contentFormat: "markdown-v1",
    createdAt: now,
    updatedAt: now,
  };

  return db.transaction((tx) => {
    const note = tx.insert(notes).values(newNote).returning().get();
    recordNoteMutation(tx, note);
    return note;
  });
}

// Get all notes with optional filtering and sorting
export async function getNotes(
  options: {
    limit?: number;
    offset?: number;
    sortBy?: "title" | "updatedAt" | "createdAt";
    sortOrder?: "asc" | "desc";
    search?: string;
  } = {},
) {
  const {
    limit = 50,
    offset = 0,
    sortBy = "updatedAt",
    sortOrder = "desc",
    search,
  } = options;

  // Build query
  let query = db.select().from(notes);

  // Apply filters
  const conditions = [visibleNotesWhere()];
  if (search) {
    conditions.push(like(notes.title, `%${search}%`));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  // Apply sorting
  const sortColumn = notes[sortBy];
  const orderFn = sortOrder === "asc" ? asc : desc;
  query = query.orderBy(orderFn(sortColumn)) as any;

  // Apply pagination
  query = query.limit(limit).offset(offset) as any;

  return await query;
}

// Get note by ID
export async function getNoteById(id: string) {
  const result = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), visibleNotesWhere()))
    .get();
  return result
    ? {
        ...result,
        remoteVersion: findNoteSyncState(db, result)?.remoteVersion ?? null,
      }
    : null;
}

// Update note
export async function updateNote(
  id: string,
  data: Partial<Pick<Note, "title" | "icon">>,
  expectedRemoteVersion?: number | null,
  original: Partial<Pick<Note, "title" | "icon">> = {},
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), visibleNotesWhere()))
      .get();
    if (!existing) return null;
    const remoteVersion =
      findNoteSyncState(tx, existing)?.remoteVersion ?? null;
    // Only a remote change to an edited field can conflict with an editor draft.
    if (
      existing.accountId &&
      expectedRemoteVersion !== undefined &&
      expectedRemoteVersion !== remoteVersion &&
      ((data.title !== undefined &&
        data.title !== existing.title &&
        original.title !== existing.title) ||
        (data.icon !== undefined &&
          data.icon !== existing.icon &&
          original.icon !== existing.icon))
    ) {
      preserveNoteConflict(
        tx,
        {
          accountId: existing.accountId,
          scopeId: existing.accountId,
          scopeType: "user",
        },
        noteSyncPayload(existing),
      );
    }
    const note = tx
      .update(notes)
      .set(updateData)
      .where(and(eq(notes.id, id), visibleNotesWhere()))
      .returning()
      .get();
    if (note) recordNoteMutation(tx, note);
    return note ? { ...note, remoteVersion } : null;
  });
}

// Delete note
export async function deleteNote(id: string) {
  // Delete the note (yjs updates and metadata will be cascade deleted)
  return db.transaction((tx) => {
    const note = tx
      .delete(notes)
      .where(and(eq(notes.id, id), visibleNotesWhere()))
      .returning()
      .get();
    if (note) recordNoteMutation(tx, note, true);
    return note ?? null;
  });
}
