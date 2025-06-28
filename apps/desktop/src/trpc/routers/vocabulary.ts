import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import {
  getVocabulary,
  getVocabularyById,
  getVocabularyByWord,
  createVocabularyWord,
  updateVocabulary,
  deleteVocabulary,
  getVocabularyCount,
  searchVocabulary,
  bulkImportVocabulary,
  trackWordUsage,
  getMostUsedWords,
} from "../../db/vocabulary";

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// Input schemas
const GetVocabularySchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(["word", "dateAdded", "usageCount"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});

const CreateVocabularySchema = z.object({
  word: z.string().min(1),
  dateAdded: z.date().optional(),
});

const UpdateVocabularySchema = z.object({
  word: z.string().min(1).optional(),
  dateAdded: z.date().optional(),
  usageCount: z.number().optional(),
});

const BulkImportSchema = z.array(
  z.object({
    word: z.string().min(1),
    dateAdded: z.date().optional(),
  }),
);

export const vocabularyRouter = t.router({
  // Get vocabulary list with pagination and filtering
  getVocabulary: t.procedure
    .input(GetVocabularySchema)
    .query(async ({ input }) => {
      return await getVocabulary(input);
    }),

  // Get vocabulary count
  getVocabularyCount: t.procedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      return await getVocabularyCount(input.search);
    }),

  // Get vocabulary by ID
  getVocabularyById: t.procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await getVocabularyById(input.id);
    }),

  // Get vocabulary by word
  getVocabularyByWord: t.procedure
    .input(z.object({ word: z.string() }))
    .query(async ({ input }) => {
      return await getVocabularyByWord(input.word);
    }),

  // Search vocabulary
  searchVocabulary: t.procedure
    .input(
      z.object({
        searchTerm: z.string(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      return await searchVocabulary(input.searchTerm, input.limit);
    }),

  // Get most used words
  getMostUsedWords: t.procedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ input }) => {
      return await getMostUsedWords(input.limit);
    }),

  // Create vocabulary word
  createVocabularyWord: t.procedure
    .input(CreateVocabularySchema)
    .mutation(async ({ input }) => {
      return await createVocabularyWord(input);
    }),

  // Update vocabulary word
  updateVocabulary: t.procedure
    .input(
      z.object({
        id: z.number(),
        data: UpdateVocabularySchema,
      }),
    )
    .mutation(async ({ input }) => {
      return await updateVocabulary(input.id, input.data);
    }),

  // Delete vocabulary word
  deleteVocabulary: t.procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return await deleteVocabulary(input.id);
    }),

  // Track word usage
  trackWordUsage: t.procedure
    .input(z.object({ word: z.string() }))
    .mutation(async ({ input }) => {
      return await trackWordUsage(input.word);
    }),

  // Bulk import vocabulary
  bulkImportVocabulary: t.procedure
    .input(BulkImportSchema)
    .mutation(async ({ input }) => {
      return await bulkImportVocabulary(input);
    }),
});
