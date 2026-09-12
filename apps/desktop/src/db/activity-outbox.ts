import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";

import { logger } from "../main/logger";
import { countWords } from "../utils/dictation-stats";
import {
  ACTIVITY_FUTURE_TOLERANCE_MS,
  ACTIVITY_MAX_BATCH_SIZE,
  ACTIVITY_MAX_REQUEST_BYTES,
  ActivityIdSchema,
  ActivityModelSchema,
  ActivitySkillsSchema,
  DictationActivitySchema,
  activityRequestBytes,
  inferHistoricalActivityModel,
  normalizeActivityAppType,
  type DictationActivity,
} from "../types/activity";
import { db } from ".";
import {
  activityMaterializationState,
  activityOutbox,
  transcriptions,
  type ActivityOutbox,
  type Transcription,
} from "./schema";

const ACTIVITY_MATERIALIZATION_STATE_ID = 1;

function historicalActivityFor(
  transcription: Transcription,
  now: Date,
): { activity: DictationActivity; assignedSessionId: string | null } | null {
  const meta =
    (transcription.meta as Record<string, unknown> | null | undefined) ?? {};
  const rawActivity =
    meta.activity && typeof meta.activity === "object"
      ? (meta.activity as Record<string, unknown>)
      : null;
  const occurredAt = transcription.createdAt;
  if (
    Number.isNaN(occurredAt.getTime()) ||
    occurredAt.getTime() > now.getTime() + ACTIVITY_FUTURE_TOLERANCE_MS
  ) {
    logger.transcription.warn(
      "Historical dictation activity timestamp was invalid; activity not queued",
      { transcriptionId: transcription.id },
    );
    return null;
  }

  const wordCount = countWords(
    transcription.text,
    transcription.detectedLanguage ?? transcription.language,
  );
  const audioDurationMs =
    typeof transcription.audioDurationMs === "number" &&
    Number.isInteger(transcription.audioDurationMs) &&
    transcription.audioDurationMs > 0
      ? transcription.audioDurationMs
      : null;
  const skills = ActivitySkillsSchema.safeParse(rawActivity?.skills);
  const transcriptionModel = rawActivity
    ? (ActivityModelSchema.safeParse(rawActivity.transcription).data ?? null)
    : inferHistoricalActivityModel(transcription.speechModel);
  const formattingModel = rawActivity
    ? (ActivityModelSchema.safeParse(rawActivity.formatting).data ?? null)
    : inferHistoricalActivityModel(transcription.formattingModel);
  const existingActivityId = ActivityIdSchema.safeParse(
    transcription.sessionId,
  );
  const activityId = existingActivityId.success
    ? existingActivityId.data
    : randomUUID();

  try {
    const activity = DictationActivitySchema.parse({
      activityId,
      occurredAt: occurredAt.toISOString(),
      wordCount,
      audioDurationMs,
      appType: rawActivity
        ? normalizeActivityAppType(rawActivity.appType)
        : null,
      skills: skills.success ? skills.data : null,
      transcription: transcriptionModel,
      formatting: formattingModel,
    });
    if (activityRequestBytes([activity]) > ACTIVITY_MAX_REQUEST_BYTES) {
      throw new Error("Valid singleton activity exceeds server body cap");
    }
    return {
      activity,
      assignedSessionId: existingActivityId.success ? null : activityId,
    };
  } catch (error) {
    logger.transcription.error(
      "Historical dictation activity was invalid; activity not queued",
      { transcriptionId: transcription.id, error },
    );
    return null;
  }
}

export interface ActivityMaterializationResult {
  enqueued: number;
  scanned: number;
}

export async function materializeCompletedDictationActivities(
  limit: number,
  database: typeof db = db,
  now = new Date(),
): Promise<ActivityMaterializationResult> {
  return database.transaction((tx) => {
    const rows = tx
      .select()
      .from(transcriptions)
      .where(
        and(
          eq(transcriptions.activityPending, true),
          eq(transcriptions.disposition, "success"),
        ),
      )
      .orderBy(asc(transcriptions.createdAt), asc(transcriptions.id))
      .limit(limit)
      .all();

    let enqueued = 0;

    for (const transcription of rows) {
      const materialized = historicalActivityFor(transcription, now);
      tx.update(transcriptions)
        .set({
          activityPending: false,
          ...(materialized?.assignedSessionId
            ? { sessionId: materialized.assignedSessionId, updatedAt: now }
            : {}),
        })
        .where(eq(transcriptions.id, transcription.id))
        .run();
      // Invalid historical payloads are skipped once, as during cursor scans.
      if (!materialized) continue;
      const { activity } = materialized;
      const inserted = tx
        .insert(activityOutbox)
        .values({
          activityId: activity.activityId,
          payload: activity,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      enqueued += inserted.changes;
    }

    return { enqueued, scanned: rows.length };
  });
}

export async function materializeAllCompletedDictationActivities(
  database: typeof db = db,
  now = new Date(),
): Promise<ActivityMaterializationResult> {
  const total: ActivityMaterializationResult = {
    enqueued: 0,
    scanned: 0,
  };

  while (true) {
    const result = await materializeCompletedDictationActivities(
      ACTIVITY_MAX_BATCH_SIZE,
      database,
      now,
    );
    total.enqueued += result.enqueued;
    total.scanned += result.scanned;
    if (result.scanned < ACTIVITY_MAX_BATCH_SIZE) return total;
  }
}

export async function activateActivityMaterializationAccount(
  accountId: string,
  database: typeof db = db,
): Promise<"replay" | "resume"> {
  return database.transaction((tx) => {
    const state = tx
      .select()
      .from(activityMaterializationState)
      .where(
        eq(activityMaterializationState.id, ACTIVITY_MATERIALIZATION_STATE_ID),
      )
      .get();

    if (state?.accountId === accountId) return "resume";

    tx.insert(activityMaterializationState)
      .values({
        id: ACTIVITY_MATERIALIZATION_STATE_ID,
        accountId,
      })
      .onConflictDoUpdate({
        target: activityMaterializationState.id,
        set: { accountId },
      })
      .run();
    tx.update(transcriptions)
      .set({ activityPending: true })
      .where(eq(transcriptions.disposition, "success"))
      .run();
    return "replay";
  });
}

export async function captureActivityRows(
  limit: number,
  database: typeof db = db,
): Promise<ActivityOutbox[]> {
  const rows = database
    .select()
    .from(activityOutbox)
    .orderBy(asc(activityOutbox.createdAt), asc(activityOutbox.activityId))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    ...row,
    payload: DictationActivitySchema.parse(row.payload),
  }));
}

export async function removeActivityRows(
  activityIds: readonly string[],
  database: typeof db = db,
): Promise<void> {
  if (activityIds.length === 0) return;

  database
    .delete(activityOutbox)
    .where(inArray(activityOutbox.activityId, [...activityIds]))
    .run();
}
