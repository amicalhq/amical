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
import { notifyTranscriptionSettled } from "./transcription-events";

/** Sealed-outcome stamp values; a NULL disposition on a session-keyed row
 * means custody was opened but the app died before the seal committed. */
export type TranscriptionDisposition =
  | "success"
  | "empty"
  | "failure"
  | "dismissed";

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
      | "audioDurationMs"
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
    if (existing.length === 0) return false;
    meta = {
      ...((existing[0].meta as Record<string, unknown> | null) ?? {}),
      ...metaPatch,
    };
  }
  await db
    .update(transcriptions)
    .set({ ...columns, ...(meta ? { meta } : {}), updatedAt: new Date() })
    .where(eq(transcriptions.sessionId, sessionId));
  return true;
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
    /** Pass null to detach a broken WAV from the settled row (D25). */
    audioFile?: string | null;
    audioDurationMs?: number;
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
      ...(stamp.audioFile !== undefined ? { audioFile: stamp.audioFile } : {}),
      ...(stamp.audioDurationMs !== undefined
        ? { audioDurationMs: stamp.audioDurationMs }
        : {}),
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
  const settled = result[0] ?? null;
  if (settled) notifyTranscriptionSettled(settled.id);
  return settled;
}

/**
 * Port-side repair (D25): settle a session that has NO row at all — the
 * provisional insert failed, or custody never opened (§3.4 still demands a
 * terminal row for every retained outcome). Existence-guarded so a commit
 * retry after a successful stamp can never duplicate a session's row.
 */
export async function insertSettledTranscription(options: {
  sessionId: string;
  disposition: TranscriptionDisposition;
  text?: string;
  metaPatch?: Record<string, unknown>;
  audioFile?: string | null;
  audioDurationMs?: number;
}) {
  const existing = await db
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .where(eq(transcriptions.sessionId, options.sessionId));
  if (existing.length > 0) return null;

  const now = new Date();
  const result = await db
    .insert(transcriptions)
    .values({
      sessionId: options.sessionId,
      disposition: options.disposition,
      text: options.text ?? "",
      audioFile: options.audioFile ?? undefined,
      audioDurationMs: options.audioDurationMs,
      meta: { sessionId: options.sessionId, ...(options.metaPatch ?? {}) },
      timestamp: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const settled = result[0] ?? null;
  if (settled) notifyTranscriptionSettled(settled.id);
  return settled;
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

/**
 * Custody invisibility (§6.2): rows with a NULL disposition belong to the
 * live lifecycle (or a crash pending recovery) — every user-facing read and
 * delete surface excludes them. Only the lifecycle and the startup sweep
 * may see or touch provisional rows.
 */
const settledRowsOnly = isNotNull(transcriptions.disposition);

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
      .where(
        and(
          settledRowsOnly,
          sql`${transcriptions.text} LIKE ${`%${search}%`} COLLATE NOCASE`,
        ),
      )
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  } else {
    return await db
      .select()
      .from(transcriptions)
      .where(settledRowsOnly)
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  }
}

// Get transcription by ID (settled rows only — ids are user-supplied)
export async function getTranscriptionById(id: number) {
  const result = await db
    .select()
    .from(transcriptions)
    .where(and(settledRowsOnly, eq(transcriptions.id, id)));
  return result[0] || null;
}

// Update transcription (settled rows only; the disposition stamp is CAS'd
// through stampTranscriptionDisposition, never through here)
export async function updateTranscription(
  id: number,
  data: Partial<Omit<Transcription, "id" | "createdAt" | "disposition">>,
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  const result = await db
    .update(transcriptions)
    .set(updateData)
    .where(and(settledRowsOnly, eq(transcriptions.id, id)))
    .returning();

  return result[0] || null;
}

// Delete transcription (settled rows only)
export async function deleteTranscription(id: number) {
  const result = await db
    .delete(transcriptions)
    .where(and(settledRowsOnly, eq(transcriptions.id, id)))
    .returning();

  return result[0] || null;
}

// Delete all transcriptions (never the live/provisional custody rows)
export async function deleteAllTranscriptions() {
  return await db.delete(transcriptions).where(settledRowsOnly).returning({
    id: transcriptions.id,
    audioFile: transcriptions.audioFile,
  });
}

// Delete transcriptions older than the provided cutoff date
export async function deleteTranscriptionsOlderThan(cutoffDate: Date) {
  return await db
    .delete(transcriptions)
    .where(and(settledRowsOnly, lt(transcriptions.timestamp, cutoffDate)))
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
      .where(
        and(
          settledRowsOnly,
          sql`${transcriptions.text} LIKE ${`%${search}%`} COLLATE NOCASE`,
        ),
      );
    return result[0]?.count || 0;
  } else {
    const result = await db
      .select({ count: count() })
      .from(transcriptions)
      .where(settledRowsOnly);
    return result[0]?.count || 0;
  }
}

// Get latest non-empty transcription
export async function getLatestTranscription() {
  const result = await db
    .select()
    .from(transcriptions)
    .where(settledRowsOnly)
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
        settledRowsOnly,
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
    .where(and(settledRowsOnly, eq(transcriptions.language, language)))
    .orderBy(desc(transcriptions.timestamp));
}

// Search transcriptions
export async function searchTranscriptions(searchTerm: string, limit = 20) {
  return await db
    .select()
    .from(transcriptions)
    .where(
      and(
        settledRowsOnly,
        sql`${transcriptions.text} LIKE ${`%${searchTerm}%`} COLLATE NOCASE`,
      ),
    )
    .orderBy(desc(transcriptions.timestamp))
    .limit(limit);
}
