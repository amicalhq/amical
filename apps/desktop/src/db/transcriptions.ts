import {
  eq,
  desc,
  asc,
  and,
  count,
  gte,
  lte,
  lt,
  sql,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { db } from ".";
import {
  transcriptions,
  type Transcription,
  type NewTranscription,
} from "./schema";

/** Sealed-outcome stamp values; a NULL disposition on a session-keyed row
 * means custody was opened but the app died before the seal committed. */
export type TranscriptionDisposition =
  | "success"
  | "empty"
  | "failure"
  | "dismissed";

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

/**
 * Open custody: the provisional row created at the first captured byte.
 * Exists so a crash mid-session leaves disk evidence for startup recovery.
 */
export async function createProvisionalTranscription(options: {
  sessionId: string;
  audioFile?: string;
}) {
  const now = new Date();
  const result = await db
    .insert(transcriptions)
    .values({
      sessionId: options.sessionId,
      disposition: null,
      audible: false,
      text: "",
      audioFile: options.audioFile,
      meta: { sessionId: options.sessionId },
      timestamp: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return result[0];
}

/** Record that audible speech was observed during capture (recovery input). */
export async function markTranscriptionAudible(sessionId: string) {
  await db
    .update(transcriptions)
    .set({ audible: true, updatedAt: new Date() })
    .where(
      and(
        eq(transcriptions.sessionId, sessionId),
        isNull(transcriptions.disposition),
      ),
    );
}

/**
 * Enrich the session's row with descriptive (non-fate) fields; metaPatch is
 * merged over the existing meta. Unlike the disposition stamp this is not
 * CAS-guarded: late enrichment of a settled row is harmless.
 */
export async function enrichTranscriptionBySession(
  sessionId: string,
  fields: Partial<
    Pick<
      Transcription,
      | "language"
      | "detectedLanguage"
      | "duration"
      | "speechModel"
      | "formattingModel"
    >
  > & { metaPatch?: Record<string, unknown> },
) {
  const { metaPatch, ...columns } = fields;
  let meta: Record<string, unknown> | undefined;
  if (metaPatch) {
    const existing = await db
      .select({ meta: transcriptions.meta })
      .from(transcriptions)
      .where(eq(transcriptions.sessionId, sessionId));
    if (existing.length === 0) return;
    meta = {
      ...((existing[0].meta as Record<string, unknown> | null) ?? {}),
      ...metaPatch,
    };
  }
  await db
    .update(transcriptions)
    .set({ ...columns, ...(meta ? { meta } : {}), updatedAt: new Date() })
    .where(eq(transcriptions.sessionId, sessionId));
}

/**
 * Stamp the sealed outcome onto the session's provisional row (status-CAS:
 * only an uncommitted row is stamped). Returns the stamped row, or null when
 * the session never opened custody or was already stamped.
 */
export async function stampTranscriptionDisposition(
  sessionId: string,
  stamp: {
    disposition: TranscriptionDisposition;
    text?: string;
    metaPatch?: Record<string, unknown>;
  },
) {
  const existing = await db
    .select()
    .from(transcriptions)
    .where(
      and(
        eq(transcriptions.sessionId, sessionId),
        isNull(transcriptions.disposition),
      ),
    );
  const row = existing[0];
  if (!row) return null;

  const meta = {
    ...((row.meta as Record<string, unknown> | null) ?? {}),
    ...(stamp.metaPatch ?? {}),
  };
  const result = await db
    .update(transcriptions)
    .set({
      disposition: stamp.disposition,
      ...(stamp.text !== undefined ? { text: stamp.text } : {}),
      meta,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(transcriptions.sessionId, sessionId),
        isNull(transcriptions.disposition),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/** Discard custody: delete the session's uncommitted row, returning it so
 * the caller can remove the audio file. */
export async function deleteProvisionalTranscription(sessionId: string) {
  const result = await db
    .delete(transcriptions)
    .where(
      and(
        eq(transcriptions.sessionId, sessionId),
        isNull(transcriptions.disposition),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/** Startup recovery scan: custody rows the app died on. */
export async function getUncommittedTranscriptions() {
  return await db
    .select()
    .from(transcriptions)
    .where(
      and(
        isNotNull(transcriptions.sessionId),
        isNull(transcriptions.disposition),
      ),
    );
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

// Delete all transcriptions
export async function deleteAllTranscriptions() {
  return await db.delete(transcriptions).returning({
    id: transcriptions.id,
    audioFile: transcriptions.audioFile,
  });
}

// Delete transcriptions older than the provided cutoff date
export async function deleteTranscriptionsOlderThan(cutoffDate: Date) {
  return await db
    .delete(transcriptions)
    .where(lt(transcriptions.timestamp, cutoffDate))
    .returning({
      id: transcriptions.id,
      audioFile: transcriptions.audioFile,
    });
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

// Get latest non-empty transcription
export async function getLatestTranscription() {
  const result = await db
    .select()
    .from(transcriptions)
    .orderBy(desc(transcriptions.timestamp))
    .limit(1);
  return result[0] || null;
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
