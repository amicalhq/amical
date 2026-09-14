import { eq, sql } from "drizzle-orm";
import { db } from ".";
import { appSettings, dictationStats } from "./schema";
import { notifyDictationStatsChanged } from "./dictation-stats-events";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type LifetimeStats = {
  totalWords: number;
  totalTranscriptions: number;
};

function readAuth(database: typeof db | DbTransaction) {
  return database
    .select({ data: appSettings.data })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .get()?.data.auth;
}

export function getLifetimeStats(
  accountId: string | null = null,
): LifetimeStats | null {
  const auth = readAuth(db);
  if (
    accountId === null
      ? auth?.isAuthenticated
      : !auth?.isAuthenticated || auth.userInfo?.sub !== accountId
  ) {
    return null;
  }

  const totals = db
    .select({
      totalWords: dictationStats.totalWords,
      totalTranscriptions: dictationStats.totalTranscriptions,
    })
    .from(dictationStats)
    .where(
      eq(
        dictationStats.scope,
        accountId === null ? "device" : `account:${accountId}`,
      ),
    )
    .get();
  return (
    totals ??
    (accountId === null ? { totalWords: 0, totalTranscriptions: 0 } : null)
  );
}

export function getStatsRevision(
  database: typeof db | DbTransaction = db,
): number {
  return (
    database
      .select({ revision: dictationStats.revision })
      .from(dictationStats)
      .where(eq(dictationStats.scope, "device"))
      .get()?.revision ?? 0
  );
}

// The caller owns the transaction and emits changed only after it commits.
export function incrementDictationStats(
  wordCount: number,
  transcriptionCount: number,
  tx: DbTransaction,
): void {
  const totalWords = Math.max(0, Math.trunc(wordCount));
  const totalTranscriptions = Math.max(0, Math.trunc(transcriptionCount));
  if (totalWords === 0 && totalTranscriptions === 0) return;

  const auth = readAuth(tx);
  const scopes = ["device"];
  if (auth?.isAuthenticated && auth.userInfo?.sub) {
    scopes.push(`account:${auth.userInfo.sub}`);
  }
  for (const scope of scopes) {
    tx.insert(dictationStats)
      .values({ scope, totalWords, totalTranscriptions, revision: 1 })
      .onConflictDoUpdate({
        target: dictationStats.scope,
        set: {
          totalWords: sql`${dictationStats.totalWords} + ${totalWords}`,
          totalTranscriptions: sql`${dictationStats.totalTranscriptions} + ${totalTranscriptions}`,
          revision: sql`${dictationStats.revision} + 1`,
        },
      })
      .run();
  }
}

export function applyAccountSummary(
  accountId: string,
  expectedRevision: number,
  totals: { words: number; activities: number },
): boolean {
  const applied = db.transaction((tx) => {
    const auth = readAuth(tx);
    if (!auth?.isAuthenticated || auth.userInfo?.sub !== accountId)
      return false;
    const revision = getStatsRevision(tx);
    if (revision !== expectedRevision) return false;

    const values = {
      totalWords: totals.words,
      totalTranscriptions: totals.activities,
      revision,
    };
    tx.insert(dictationStats)
      .values({ scope: `account:${accountId}`, ...values })
      .onConflictDoUpdate({ target: dictationStats.scope, set: values })
      .run();
    return true;
  });
  if (applied) notifyDictationStatsChanged();
  return applied;
}
