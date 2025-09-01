import { eq, desc, asc, like, and, isNull } from "drizzle-orm";
import { db } from "./config";
import {
  notes,
  noteMetadata,
  yjsUpdates,
  type Note,
  type NewNote,
  type NoteMetadata,
  type NewNoteMetadata,
} from "./schema";

// Create a new note
export async function createNote(
  data: Omit<NewNote, "id" | "createdAt" | "updatedAt" | "lastAccessedAt">,
) {
  const now = new Date();

  const newNote: NewNote = {
    ...data,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  };

  const result = await db.insert(notes).values(newNote).returning();
  return result[0];
}

// Get all notes with optional filtering and sorting
export async function getNotes(
  options: {
    limit?: number;
    offset?: number;
    sortBy?: "title" | "updatedAt" | "createdAt" | "lastAccessedAt";
    sortOrder?: "asc" | "desc";
    search?: string;
    transcriptionId?: number | null;
  } = {},
) {
  const {
    limit = 50,
    offset = 0,
    sortBy = "updatedAt",
    sortOrder = "desc",
    search,
    transcriptionId,
  } = options;

  // Build query
  let query = db.select().from(notes);

  // Apply filters
  const conditions = [];
  if (search) {
    conditions.push(like(notes.title, `%${search}%`));
  }
  if (transcriptionId !== undefined) {
    conditions.push(
      transcriptionId === null
        ? isNull(notes.transcriptionId)
        : eq(notes.transcriptionId, transcriptionId),
    );
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
export async function getNoteById(id: number) {
  const result = await db.select().from(notes).where(eq(notes.id, id));
  return result[0] || null;
}

// Get note by document name
export async function getNoteByDocName(docName: string) {
  const result = await db
    .select()
    .from(notes)
    .where(eq(notes.docName, docName));
  return result[0] || null;
}

// Update note
export async function updateNote(
  id: number,
  data: Partial<Omit<Note, "id" | "createdAt" | "docName">>,
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  const result = await db
    .update(notes)
    .set(updateData)
    .where(eq(notes.id, id))
    .returning();

  return result[0] || null;
}

// Update note last accessed time
export async function touchNote(id: number) {
  const result = await db
    .update(notes)
    .set({ lastAccessedAt: new Date() })
    .where(eq(notes.id, id))
    .returning();

  return result[0] || null;
}

// Delete note
export async function deleteNote(id: number) {
  // Get the note first to get docName
  const note = await getNoteById(id);
  if (!note) return null;

  // Delete all yjs updates for this document
  await db.delete(yjsUpdates).where(eq(yjsUpdates.docName, note.docName));

  // Delete the note (metadata will be cascade deleted)
  const result = await db.delete(notes).where(eq(notes.id, id)).returning();

  return result[0] || null;
}

// Get notes by transcription ID
export async function getNotesByTranscriptionId(transcriptionId: number) {
  return await db
    .select()
    .from(notes)
    .where(eq(notes.transcriptionId, transcriptionId))
    .orderBy(desc(notes.updatedAt));
}

// Note metadata operations
export async function setNoteMetadata(
  noteId: number,
  key: string,
  value: string,
) {
  const data: NewNoteMetadata = { noteId, key, value };

  // Upsert metadata
  await db
    .insert(noteMetadata)
    .values(data)
    .onConflictDoUpdate({
      target: [noteMetadata.noteId, noteMetadata.key],
      set: { value },
    });
}

export async function getNoteMetadata(noteId: number, key?: string) {
  if (key) {
    const result = await db
      .select()
      .from(noteMetadata)
      .where(and(eq(noteMetadata.noteId, noteId), eq(noteMetadata.key, key)));
    return result[0] || null;
  } else {
    return await db
      .select()
      .from(noteMetadata)
      .where(eq(noteMetadata.noteId, noteId));
  }
}

export async function deleteNoteMetadata(noteId: number, key: string) {
  await db
    .delete(noteMetadata)
    .where(and(eq(noteMetadata.noteId, noteId), eq(noteMetadata.key, key)));
}

// Generate a unique document name for a new note
export function generateDocName(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
