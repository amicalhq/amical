import { sql } from "drizzle-orm";
import { db } from ".";
import { dailyStats } from "./schema";
import { toLocalStatsDate } from "../utils/dictation-stats";

export type LifetimeStats = {
  totalWords: number;
  totalTranscriptions: number;
};

export type DailyStatSeed = {
  date: string;
  wordCount: number;
  transcriptionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function incrementDailyStats(
  wordCount: number,
  timestamp = new Date(),
  transcriptionCount = 1,
): Promise<void> {
  const safeWordCount = Math.max(0, Math.trunc(wordCount));
  const safeTranscriptionCount = Math.max(0, Math.trunc(transcriptionCount));
  if (safeWordCount === 0 && safeTranscriptionCount === 0) {
    return;
  }

  const date = toLocalStatsDate(timestamp);
  const now = timestamp;

  await db
    .insert(dailyStats)
    .values({
      id: crypto.randomUUID(),
      date,
      wordCount: safeWordCount,
      transcriptionCount: safeTranscriptionCount,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dailyStats.date,
      set: {
        wordCount: sql`${dailyStats.wordCount} + ${safeWordCount}`,
        transcriptionCount: sql`${dailyStats.transcriptionCount} + ${safeTranscriptionCount}`,
        updatedAt: now,
      },
    });
}

export async function getLifetimeStats(): Promise<LifetimeStats> {
  const result = await db
    .select({
      totalWords: sql<number>`COALESCE(SUM(${dailyStats.wordCount}), 0)`,
      totalTranscriptions: sql<number>`COALESCE(SUM(${dailyStats.transcriptionCount}), 0)`,
    })
    .from(dailyStats);

  return {
    totalWords: result[0]?.totalWords ?? 0,
    totalTranscriptions: result[0]?.totalTranscriptions ?? 0,
  };
}

export async function seedDailyStats(rows: DailyStatSeed[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(dailyStats);

    for (const row of rows) {
      await tx.insert(dailyStats).values({
        id: crypto.randomUUID(),
        date: row.date,
        wordCount: row.wordCount,
        transcriptionCount: row.transcriptionCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
  });
}
