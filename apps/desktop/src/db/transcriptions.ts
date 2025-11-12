import {
  eq,
  desc,
  asc,
  and,
  ilike,
  count,
  gte,
  lte,
  sql,
  like,
} from "drizzle-orm";
import { db } from ".";
import {
  transcriptions,
  type Transcription,
  type NewTranscription,
} from "./schema";

// Create a new transcription
export async function createTranscription(
  data: Omit<NewTranscription, "id" | "createdAt" | "updatedAt">,
) {
  const now = new Date();

  const newTranscription: NewTranscription = {
    ...data,
    timestamp: data.timestamp || now,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db
    .insert(transcriptions)
    .values(newTranscription)
    .returning();
  return result[0];
}

// Get all transcriptions with pagination and sorting
export async function getTranscriptions(
  options: {
    limit?: number;
    offset?: number;
    sortBy?: "timestamp" | "createdAt";
    sortOrder?: "asc" | "desc";
    search?: string;
  } = {},
) {
  const {
    limit = 50,
    offset = 0,
    sortBy = "timestamp",
    sortOrder = "desc",
    search,
  } = options;

  // Build query with conditional where clause
  const sortColumn =
    sortBy === "timestamp"
      ? transcriptions.timestamp
      : transcriptions.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  if (search) {
    return await db
      .select()
      .from(transcriptions)
      .where(sql`${transcriptions.text} LIKE ${`%${search}%`} COLLATE NOCASE`)
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  } else {
    return await db
      .select()
      .from(transcriptions)
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  }
}

// Get transcription by ID
export async function getTranscriptionById(id: number) {
  const result = await db
    .select()
    .from(transcriptions)
    .where(eq(transcriptions.id, id));
  return result[0] || null;
}

// Update transcription
export async function updateTranscription(
  id: number,
  data: Partial<Omit<Transcription, "id" | "createdAt">>,
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  const result = await db
    .update(transcriptions)
    .set(updateData)
    .where(eq(transcriptions.id, id))
    .returning();

  return result[0] || null;
}

// Delete transcription
export async function deleteTranscription(id: number) {
  const result = await db
    .delete(transcriptions)
    .where(eq(transcriptions.id, id))
    .returning();

  return result[0] || null;
}

// Get transcriptions count
export async function getTranscriptionsCount(search?: string) {
  if (search) {
    const result = await db
      .select({ count: count() })
      .from(transcriptions)
      .where(sql`${transcriptions.text} LIKE ${`%${search}%`} COLLATE NOCASE`);
    return result[0]?.count || 0;
  } else {
    const result = await db.select({ count: count() }).from(transcriptions);
    return result[0]?.count || 0;
  }
}

// Get transcriptions by date range
export async function getTranscriptionsByDateRange(
  startDate: Date,
  endDate: Date,
) {
  return await db
    .select()
    .from(transcriptions)
    .where(
      and(
        gte(transcriptions.timestamp, startDate),
        lte(transcriptions.timestamp, endDate),
      ),
    )
    .orderBy(desc(transcriptions.timestamp));
}

// Get transcriptions by language
export async function getTranscriptionsByLanguage(language: string) {
  return await db
    .select()
    .from(transcriptions)
    .where(eq(transcriptions.language, language))
    .orderBy(desc(transcriptions.timestamp));
}

// Search transcriptions
export async function searchTranscriptions(searchTerm: string, limit = 20) {
  return await db
    .select()
    .from(transcriptions)
    .where(sql`${transcriptions.text} LIKE ${`%${searchTerm}%`} COLLATE NOCASE`)
    .orderBy(desc(transcriptions.timestamp))
    .limit(limit);
}
