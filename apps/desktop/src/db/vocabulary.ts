import { and, eq, sql } from "drizzle-orm";
import { db } from ".";
import { vocabulary, type Vocabulary, type NewVocabulary } from "./schema";
import {
  recordLocalSyncMutation,
  recordLocalSyncMutations,
  recordOrganizationSyncMutation,
  getActiveOrganizationAccess,
  getWritableOrganizationIdentity,
  vocabularySyncPayload,
} from "./sync";

export type LanguageAssetScopeFilter = "all" | "user" | "org";

function effectiveVocabulary(rows: Vocabulary[]): Vocabulary[] {
  const effective = new Map<string, Vocabulary>();
  for (const row of [...rows].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const existing = effective.get(row.word);
    if (!existing || row.scopeType === "user") effective.set(row.word, row);
  }
  return [...effective.values()];
}

async function readableVocabulary(rows: Vocabulary[]): Promise<Vocabulary[]> {
  const organization = await getActiveOrganizationAccess();
  return rows.filter(
    (row) =>
      (row.scopeType === "user" && row.scopeId === "") ||
      (row.scopeType === "org" && row.scopeId === organization?.scopeId),
  );
}

// Create a new vocabulary word
export async function createVocabularyWord(
  data: Omit<
    NewVocabulary,
    "id" | "scopeType" | "scopeId" | "createdAt" | "updatedAt"
  >,
) {
  const now = new Date();

  const newWord: NewVocabulary = {
    ...data,
    scopeType: "user",
    scopeId: "",
    dateAdded: data.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  };

  return db.transaction((tx) => {
    const created = tx.insert(vocabulary).values(newWord).returning().get();
    recordLocalSyncMutation(
      tx,
      "vocabulary",
      created.id,
      vocabularySyncPayload(created),
    );
    return created;
  });
}

export async function createOrganizationVocabularyWord(
  data: Omit<
    NewVocabulary,
    "id" | "scopeType" | "scopeId" | "createdAt" | "updatedAt"
  >,
) {
  const identity = getWritableOrganizationIdentity();
  if (!identity) throw new Error("Organization language assets are read-only");
  const now = new Date();

  return db.transaction((tx) => {
    const created = tx
      .insert(vocabulary)
      .values({
        ...data,
        scopeType: "org",
        scopeId: identity.scopeId,
        dateAdded: data.dateAdded || now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    recordOrganizationSyncMutation(
      tx,
      "vocabulary",
      created.id,
      vocabularySyncPayload(created),
    );
    return created;
  });
}

/**
 * Load every vocabulary row. Used by the transcription pipeline so that every
 * entry the user has authored participates in expansion / hints — no silent
 * cap. The settings UI uses `getVocabulary` which is capped/sortable/searchable.
 */
export async function getAllVocabulary(): Promise<Vocabulary[]> {
  return effectiveVocabulary(
    await readableVocabulary(await db.select().from(vocabulary)),
  );
}

// Get all vocabulary words with pagination and sorting
export async function getVocabulary(
  options: {
    limit?: number;
    offset?: number;
    sortBy?: "word" | "dateAdded" | "usageCount";
    sortOrder?: "asc" | "desc";
    search?: string;
    scope?: LanguageAssetScopeFilter;
  } = {},
) {
  const {
    limit = 50,
    offset = 0,
    sortBy = "dateAdded",
    sortOrder = "desc",
    search,
    scope = "all",
  } = options;
  const searchTerm = search?.toLocaleLowerCase();
  const scopedRows = (
    await readableVocabulary(await db.select().from(vocabulary))
  ).filter(
    (row) =>
      (scope === "all" || row.scopeType === scope) &&
      (!searchTerm || row.word.toLocaleLowerCase().includes(searchTerm)),
  );
  const rows = scope === "all" ? effectiveVocabulary(scopedRows) : scopedRows;
  const direction = sortOrder === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    let comparison: number;
    if (sortBy === "word") {
      comparison = left.word.localeCompare(right.word);
    } else if (sortBy === "usageCount") {
      comparison = (left.usageCount ?? 0) - (right.usageCount ?? 0);
    } else {
      comparison = left.dateAdded.getTime() - right.dateAdded.getTime();
    }
    return comparison === 0
      ? left.id.localeCompare(right.id)
      : comparison * direction;
  });
  return rows.slice(offset, offset + limit);
}

// Get vocabulary word by ID
export async function getVocabularyById(id: string) {
  const result = await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.id, id));
  const readable = await readableVocabulary(result);
  return (
    readable.find((row) => row.scopeType === "user") ?? readable[0] ?? null
  );
}

// Get vocabulary word by word text
export async function getVocabularyByWord(word: string) {
  const result = await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.word, word.toLowerCase()));
  return effectiveVocabulary(await readableVocabulary(result))[0] || null;
}

// Update vocabulary word
export async function updateVocabulary(
  id: string,
  data: Partial<Omit<Vocabulary, "id" | "scopeType" | "scopeId" | "createdAt">>,
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  return db.transaction((tx) => {
    const updated = tx
      .update(vocabulary)
      .set(updateData)
      .where(
        and(
          eq(vocabulary.id, id),
          eq(vocabulary.scopeType, "user"),
          eq(vocabulary.scopeId, ""),
        ),
      )
      .returning()
      .get();
    if (!updated) return null;

    const changesSyncPayload =
      Object.hasOwn(data, "word") || Object.hasOwn(data, "replacementWord");
    if (changesSyncPayload) {
      recordLocalSyncMutation(
        tx,
        "vocabulary",
        updated.id,
        vocabularySyncPayload(updated),
      );
    }
    return updated;
  });
}

export async function updateOrganizationVocabulary(
  id: string,
  data: Partial<Omit<Vocabulary, "id" | "scopeType" | "scopeId" | "createdAt">>,
) {
  const identity = getWritableOrganizationIdentity();
  if (!identity) throw new Error("Organization language assets are read-only");

  return db.transaction((tx) => {
    const updated = tx
      .update(vocabulary)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(vocabulary.id, id),
          eq(vocabulary.scopeType, "org"),
          eq(vocabulary.scopeId, identity.scopeId),
        ),
      )
      .returning()
      .get();
    if (!updated) return null;
    if (Object.hasOwn(data, "word") || Object.hasOwn(data, "replacementWord")) {
      recordOrganizationSyncMutation(
        tx,
        "vocabulary",
        updated.id,
        vocabularySyncPayload(updated),
      );
    }
    return updated;
  });
}

// Delete vocabulary word
export async function deleteVocabulary(id: string) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(vocabulary)
      .where(
        and(
          eq(vocabulary.id, id),
          eq(vocabulary.scopeType, "user"),
          eq(vocabulary.scopeId, ""),
        ),
      )
      .limit(1)
      .get();
    if (!existing) return null;

    recordLocalSyncMutation(tx, "vocabulary", existing.id, null);
    const deleted = tx
      .delete(vocabulary)
      .where(
        and(
          eq(vocabulary.id, id),
          eq(vocabulary.scopeType, "user"),
          eq(vocabulary.scopeId, ""),
        ),
      )
      .returning()
      .get();
    return deleted ?? null;
  });
}

export async function deleteOrganizationVocabulary(id: string) {
  const identity = getWritableOrganizationIdentity();
  if (!identity) throw new Error("Organization language assets are read-only");

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(vocabulary)
      .where(
        and(
          eq(vocabulary.id, id),
          eq(vocabulary.scopeType, "org"),
          eq(vocabulary.scopeId, identity.scopeId),
        ),
      )
      .limit(1)
      .get();
    if (!existing) return null;
    recordOrganizationSyncMutation(tx, "vocabulary", existing.id, null);
    return (
      tx
        .delete(vocabulary)
        .where(
          and(
            eq(vocabulary.id, id),
            eq(vocabulary.scopeType, "org"),
            eq(vocabulary.scopeId, identity.scopeId),
          ),
        )
        .returning()
        .get() ?? null
    );
  });
}

// Get vocabulary count
export async function getVocabularyCount(
  search?: string,
  scope: LanguageAssetScopeFilter = "all",
) {
  return (
    await getVocabulary({
      limit: Number.MAX_SAFE_INTEGER,
      search,
      scope,
    })
  ).length;
}

// Track word usage - increment usage count atomically
export async function trackWordUsage(word: string) {
  const organization = await getActiveOrganizationAccess();
  return db.transaction((tx) => {
    const effective = effectiveVocabulary(
      tx
        .select()
        .from(vocabulary)
        .where(eq(vocabulary.word, word.toLowerCase()))
        .all()
        .filter(
          (row) =>
            (row.scopeType === "user" && row.scopeId === "") ||
            (row.scopeType === "org" && row.scopeId === organization?.scopeId),
        ),
    )[0];
    if (!effective) return null;
    return (
      tx
        .update(vocabulary)
        .set({
          usageCount: sql`${vocabulary.usageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(vocabulary.id, effective.id),
            eq(vocabulary.scopeType, effective.scopeType),
            eq(vocabulary.scopeId, effective.scopeId),
          ),
        )
        .returning()
        .get() ?? null
    );
  });
}

// Get most frequently used words
export async function getMostUsedWords(limit = 10) {
  return (await getAllVocabulary())
    .filter((row) => (row.usageCount ?? 0) > 0)
    .sort((left, right) => (right.usageCount ?? 0) - (left.usageCount ?? 0))
    .slice(0, limit);
}

// Search vocabulary words
export async function searchVocabulary(searchTerm: string, limit = 20) {
  return getVocabulary({
    search: searchTerm,
    limit,
    sortBy: "word",
    sortOrder: "asc",
  });
}

// Bulk import vocabulary words
export async function bulkImportVocabulary(
  words: Omit<
    NewVocabulary,
    "id" | "scopeType" | "scopeId" | "createdAt" | "updatedAt"
  >[],
) {
  const now = new Date();

  const vocabularyWords = words.map((word) => ({
    ...word,
    scopeType: "user" as const,
    scopeId: "",
    dateAdded: word.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  }));

  return db.transaction((tx) => {
    const created = tx
      .insert(vocabulary)
      .values(vocabularyWords)
      .returning()
      .all();
    recordLocalSyncMutations(
      tx,
      created.map((row) => ({
        collection: "vocabulary",
        syncId: row.id,
        payload: vocabularySyncPayload(row),
      })),
    );
    return created;
  });
}
