import { eq, desc, asc, like, and } from "drizzle-orm";
import { db } from "./index";
import { notes, type Note, type NewNote } from "./schema";

// Create a new note
export async function createNote(data: Pick<NewNote, "title" | "icon">) {
  const now = new Date();

  const newNote: NewNote = {
    ...data,
    content: "",
    contentFormat: "markdown-v1",
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
export async function getNoteById(id: string) {
  const result = await db.select().from(notes).where(eq(notes.id, id));
  return result[0] || null;
}

// Update note
export async function updateNote(
  id: string,
  data: Partial<Pick<Note, "title" | "icon">>,
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
export async function deleteNote(id: string) {
  // Delete the note (yjs updates and metadata will be cascade deleted)
  const result = await db.delete(notes).where(eq(notes.id, id)).returning();
  return result[0] || null;
}
