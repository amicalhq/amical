import { randomUUID } from "node:crypto";
import { asc, eq, gt, inArray } from "drizzle-orm";

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
  advanced: boolean;
  enqueued: number;
  scanned: number;
}

export async function materializeCompletedDictationActivities(
  limit: number,
  database: typeof db = db,
  now = new Date(),
): Promise<ActivityMaterializationResult> {
  return database.transaction((tx) => {
    tx.insert(activityMaterializationState)
      .values({ id: ACTIVITY_MATERIALIZATION_STATE_ID })
      .onConflictDoNothing()
      .run();
    const state = tx
      .select()
      .from(activityMaterializationState)
      .where(
        eq(activityMaterializationState.id, ACTIVITY_MATERIALIZATION_STATE_ID),
      )
      .get();
    const cursor = state?.transcriptionCursor ?? 0;
    const rows = tx
      .select()
      .from(transcriptions)
      .where(gt(transcriptions.id, cursor))
      .orderBy(asc(transcriptions.id))
      .limit(limit)
      .all();

    let nextCursor = cursor;
    let enqueued = 0;
    let scanned = 0;

    for (const transcription of rows) {
      scanned += 1;
      nextCursor = transcription.id;
      if (transcription.disposition === null) {
        // Best effort by design: a later settlement is materialized directly,
        // while a crash between the skip and settlement may omit this activity.
        logger.transcription.warn(
          "Skipping unsettled transcription during activity materialization",
          { transcriptionId: transcription.id },
        );
        continue;
      }

      if (transcription.disposition !== "success") continue;

      const materialized = historicalActivityFor(transcription, now);
      if (!materialized) continue;
      const { activity, assignedSessionId } = materialized;
      if (assignedSessionId) {
        tx.update(transcriptions)
          .set({ sessionId: assignedSessionId, updatedAt: now })
          .where(eq(transcriptions.id, transcription.id))
          .run();
      }
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

    if (nextCursor !== cursor) {
      tx.update(activityMaterializationState)
        .set({ transcriptionCursor: nextCursor })
        .where(
          eq(
            activityMaterializationState.id,
            ACTIVITY_MATERIALIZATION_STATE_ID,
          ),
        )
        .run();
    }

    return {
      advanced: nextCursor !== cursor,
      enqueued,
      scanned,
    };
  });
}

export async function materializeAllCompletedDictationActivities(
  database: typeof db = db,
  now = new Date(),
): Promise<ActivityMaterializationResult> {
  const total: ActivityMaterializationResult = {
    advanced: false,
    enqueued: 0,
    scanned: 0,
  };

  while (true) {
    const result = await materializeCompletedDictationActivities(
      ACTIVITY_MAX_BATCH_SIZE,
      database,
      now,
    );
    total.advanced ||= result.advanced;
    total.enqueued += result.enqueued;
    total.scanned += result.scanned;
    if (!result.advanced) return total;
  }
}

export async function materializeCompletedDictationActivity(
  transcriptionId: number,
  database: typeof db = db,
  now = new Date(),
): Promise<boolean> {
  return database.transaction((tx) => {
    const transcription = tx
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId))
      .get();
    if (!transcription || transcription.disposition !== "success") {
      return false;
    }

    const materialized = historicalActivityFor(transcription, now);
    if (!materialized) return false;
    const { activity, assignedSessionId } = materialized;
    if (assignedSessionId) {
      tx.update(transcriptions)
        .set({ sessionId: assignedSessionId, updatedAt: now })
        .where(eq(transcriptions.id, transcription.id))
        .run();
    }
    const inserted = tx
      .insert(activityOutbox)
      .values({
        activityId: activity.activityId,
        payload: activity,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    return inserted.changes > 0;
  });
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
        transcriptionCursor: 0,
      })
      .onConflictDoUpdate({
        target: activityMaterializationState.id,
        set: { accountId, transcriptionCursor: 0 },
      })
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
