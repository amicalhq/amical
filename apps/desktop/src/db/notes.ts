import { eq, desc, asc, like, and, isNull } from "drizzle-orm";
import { db } from "./index";
import {
  notes,
  yjsUpdates,
  type Note,
  type NewNote,
  type YjsUpdate,
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
  };

  const result = await db.insert(notes).values(newNote).returning();
  return result[0];
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
  const conditions = [];
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
export async function getNoteById(id: number) {
  const result = await db.select().from(notes).where(eq(notes.id, id));
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

// Delete note
export async function deleteNote(id: number) {
  // Delete the note (yjs updates and metadata will be cascade deleted)
  const result = await db.delete(notes).where(eq(notes.id, id)).returning();
  return result[0] || null;
}

// YJS Updates operations

// Save a YJS update to the database
export async function saveYjsUpdate(noteId: number, update: Uint8Array) {
  // Convert Uint8Array to Buffer for storage
  const bufferUpdate = Buffer.from(update);

  // Insert into yjs_updates table
  await db.insert(yjsUpdates).values({
    noteId,
    updateData: bufferUpdate,
  });
}

// Load all YJS updates for a note
export async function loadYjsUpdates(noteId: number): Promise<Uint8Array[]> {
  const updates = await db
    .select()
    .from(yjsUpdates)
    .where(eq(yjsUpdates.noteId, noteId))
    .orderBy(asc(yjsUpdates.id));

  // Convert Buffer to Uint8Array
  return updates.map((u: YjsUpdate) => {
    return new Uint8Array(u.updateData as Buffer);
  });
}

// Get all unique note IDs that have updates
export async function getUniqueNoteIds(): Promise<number[]> {
  const result = await db
    .select({ noteId: yjsUpdates.noteId })
    .from(yjsUpdates)
    .groupBy(yjsUpdates.noteId);

  return result.map((r: { noteId: number }) => r.noteId);
}

// Get all YJS updates for a specific note
export async function getYjsUpdatesByNoteId(
  noteId: number,
): Promise<YjsUpdate[]> {
  return await db
    .select()
    .from(yjsUpdates)
    .where(eq(yjsUpdates.noteId, noteId))
    .orderBy(asc(yjsUpdates.id));
}

// Replace all YJS updates with a compacted one (transactional)
export async function replaceYjsUpdates(
  noteId: number,
  compactedUpdate: Uint8Array,
): Promise<void> {
  const bufferUpdate = Buffer.from(compactedUpdate);

  await db.transaction(async (tx) => {
    // Delete all existing updates
    await tx.delete(yjsUpdates).where(eq(yjsUpdates.noteId, noteId));

    // Insert the compacted update
    await tx.insert(yjsUpdates).values({
      noteId,
      updateData: bufferUpdate,
    });
  });
}
