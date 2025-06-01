import { eq, desc, asc, like, count, and } from 'drizzle-orm';
import { db } from './config';
import { vocabulary, type Vocabulary, type NewVocabulary } from './schema';

// Create a new vocabulary word
export async function createVocabularyWord(data: Omit<NewVocabulary, 'id' | 'createdAt' | 'updatedAt'>) {
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
export async function getVocabulary(options: {
  limit?: number;
  offset?: number;
  sortBy?: 'word' | 'dateAdded' | 'lastUsed' | 'usageCount' | 'priority';
  sortOrder?: 'asc' | 'desc';
  search?: string;
  category?: string;
} = {}) {
  const {
    limit = 50,
    offset = 0,
    sortBy = 'dateAdded',
    sortOrder = 'desc',
    search,
    category,
  } = options;

  let query = db.select().from(vocabulary);

  // Add filters
  const conditions = [];
  
  if (search) {
    conditions.push(like(vocabulary.word, `%${search}%`));
  }
  
  if (category) {
    conditions.push(eq(vocabulary.category, category));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  // Add sorting
  let sortColumn;
  switch (sortBy) {
    case 'word':
      sortColumn = vocabulary.word;
      break;
    case 'lastUsed':
      sortColumn = vocabulary.lastUsed;
      break;
    case 'usageCount':
      sortColumn = vocabulary.usageCount;
      break;
    case 'priority':
      sortColumn = vocabulary.priority;
      break;
    default:
      sortColumn = vocabulary.dateAdded;
  }
  
  const orderFn = sortOrder === 'asc' ? asc : desc;
  query = query.orderBy(orderFn(sortColumn));

  // Add pagination
  query = query.limit(limit).offset(offset);

  return await query;
}

// Get vocabulary word by ID
export async function getVocabularyById(id: number) {
  const result = await db.select().from(vocabulary).where(eq(vocabulary.id, id));
  return result[0] || null;
}

// Get vocabulary word by word text
export async function getVocabularyByWord(word: string) {
  const result = await db.select().from(vocabulary).where(eq(vocabulary.word, word.toLowerCase()));
  return result[0] || null;
}

// Update vocabulary word
export async function updateVocabulary(id: number, data: Partial<Omit<Vocabulary, 'id' | 'createdAt'>>) {
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
export async function getVocabularyCount(search?: string, category?: string) {
  let query = db.select({ count: count() }).from(vocabulary);
  
  const conditions = [];
  
  if (search) {
    conditions.push(like(vocabulary.word, `%${search}%`));
  }
  
  if (category) {
    conditions.push(eq(vocabulary.category, category));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  
  const result = await query;
  return result[0]?.count || 0;
}

// Track word usage - increment usage count and update last used timestamp
export async function trackWordUsage(word: string) {
  const existingWord = await getVocabularyByWord(word);
  
  if (existingWord) {
    await db
      .update(vocabulary)
      .set({
        usageCount: (existingWord.usageCount || 0) + 1,
        lastUsed: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vocabulary.id, existingWord.id));
    
    return existingWord;
  }
  
  return null;
}

// Get most frequently used words
export async function getMostUsedWords(limit = 10) {
  return await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.usageCount, 0)) // Only words that have been used
    .orderBy(desc(vocabulary.usageCount))
    .limit(limit);
}

// Get high priority words
export async function getHighPriorityWords() {
  return await db
    .select()
    .from(vocabulary)
    .where(eq(vocabulary.priority, 3)) // Priority 3 and above
    .orderBy(desc(vocabulary.priority));
}

// Get vocabulary categories
export async function getVocabularyCategories() {
  const result = await db
    .selectDistinct({ category: vocabulary.category })
    .from(vocabulary)
    .where(eq(vocabulary.category, null)); // Only non-null categories
  
  return result.map(row => row.category).filter(Boolean);
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
export async function bulkImportVocabulary(words: Omit<NewVocabulary, 'id' | 'createdAt' | 'updatedAt'>[]) {
  const now = new Date();
  
  const vocabularyWords = words.map(word => ({
    ...word,
    dateAdded: word.dateAdded || now,
    createdAt: now,
    updatedAt: now,
  }));

  return await db.insert(vocabulary).values(vocabularyWords).returning();
} 