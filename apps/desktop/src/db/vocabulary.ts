import { eq, desc, asc, like, count, gt, sql } from "drizzle-orm";
import { db } from ".";
import { vocabulary, type Vocabulary, type NewVocabulary } from "./schema";

// Create a new vocabulary word
export async function createVocabularyWord(
  data: Omit<NewVocabulary, "id" | "createdAt" | "updatedAt">,
) {
  const now = new Date();

  const newWord: NewVocabulary = {
    ...data,
    dateAdded: data.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.insert(vocabulary).values(newWord).returning();
  return result[0];
}

// Get all vocabulary words with pagination and sorting
export async function getVocabulary(
  options: {
    limit?: number;
    offset?: number;
    sortBy?: "word" | "dateAdded" | "usageCount";
    sortOrder?: "asc" | "desc";
    search?: string;
  } = {},
) {
  const {
    limit = 50,
    offset = 0,
    sortBy = "dateAdded",
    sortOrder = "desc",
    search,
  } = options;

  // Determine sort column
  let sortColumn;
  switch (sortBy) {
    case "word":
      sortColumn = vocabulary.word;
      break;
    case "usageCount":
      sortColumn = vocabulary.usageCount;
      break;
    default:
      sortColumn = vocabulary.dateAdded;
  }

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Build query with conditional where clause
  if (search) {
    return await db
      .select()
      .from(vocabulary)
      .where(like(vocabulary.word, `%${search}%`))
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  } else {
    return await db
      .select()
      .from(vocabulary)
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);
  }
}

// Get vocabulary word by ID
export async function getVocabularyById(id: number) {
  const result = await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.id, id));
  return result[0] || null;
}

// Get vocabulary word by word text
export async function getVocabularyByWord(word: string) {
  const result = await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.word, word.toLowerCase()));
  return result[0] || null;
}

// Update vocabulary word
export async function updateVocabulary(
  id: number,
  data: Partial<Omit<Vocabulary, "id" | "createdAt">>,
) {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };

  const result = await db
    .update(vocabulary)
    .set(updateData)
    .where(eq(vocabulary.id, id))
    .returning();

  return result[0] || null;
}

// Delete vocabulary word
export async function deleteVocabulary(id: number) {
  const result = await db
    .delete(vocabulary)
    .where(eq(vocabulary.id, id))
    .returning();

  return result[0] || null;
}

// Get vocabulary count
export async function getVocabularyCount(search?: string) {
  if (search) {
    const result = await db
      .select({ count: count() })
      .from(vocabulary)
      .where(like(vocabulary.word, `%${search}%`));
    return result[0]?.count || 0;
  } else {
    const result = await db.select({ count: count() }).from(vocabulary);
    return result[0]?.count || 0;
  }
}

// Track word usage - increment usage count atomically
export async function trackWordUsage(word: string) {
  // Use atomic update with SQL increment to avoid race conditions
  const result = await db
    .update(vocabulary)
    .set({
      usageCount: sql`${vocabulary.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(vocabulary.word, word.toLowerCase()))
    .returning();

  return result[0] || null;
}

// Get most frequently used words
export async function getMostUsedWords(limit = 10) {
  return await db
    .select()
    .from(vocabulary)
    .where(gt(vocabulary.usageCount, 0)) // Only words that have been used
    .orderBy(desc(vocabulary.usageCount))
    .limit(limit);
}

// Search vocabulary words
export async function searchVocabulary(searchTerm: string, limit = 20) {
  return await db
    .select()
    .from(vocabulary)
    .where(like(vocabulary.word, `%${searchTerm}%`))
    .orderBy(asc(vocabulary.word))
    .limit(limit);
}

// Bulk import vocabulary words
export async function bulkImportVocabulary(
  words: Omit<NewVocabulary, "id" | "createdAt" | "updatedAt">[],
) {
  const now = new Date();

  const vocabularyWords = words.map((word) => ({
    ...word,
    dateAdded: word.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  }));

  return await db.insert(vocabulary).values(vocabularyWords).returning();
}
