import { z } from "zod";
import { createRouter, procedure } from "../trpc";
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

// Input schemas
const GetVocabularySchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(["word", "dateAdded", "usageCount"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});

const CreateVocabularySchema = z
  .object({
    word: z.string().min(1),
    isReplacement: z.boolean().optional(),
    replacementWord: z.string().optional(),
  })
  .refine(
    (data) => {
      // If isReplacement is true, replacementWord must be provided
      if (data.isReplacement === true && !data.replacementWord) {
        return false;
      }
      return true;
    },
    {
      message: "replacementWord is required when isReplacement is true",
      path: ["replacementWord"],
    },
  )
  .refine(
    (data) => {
      // If both word and replacementWord are provided, they must be different
      if (data.word && data.replacementWord) {
        return data.word !== data.replacementWord;
      }
      return true;
    },
    {
      path: ["replacementWord"],
      message: "replacementWord must be different from word",
    },
  );

const UpdateVocabularySchema = z
  .object({
    word: z.string().min(1).optional(),
    isReplacement: z.boolean().optional(),
    replacementWord: z.string().optional(),
  })
  .refine(
    (data) => {
      // If isReplacement is true, replacementWord must be provided
      if (data.isReplacement === true && !data.replacementWord) {
        return false;
      }
      return true;
    },
    {
      message: "replacementWord is required when isReplacement is true",
      path: ["replacementWord"],
    },
  )
  .refine(
    (data) => {
      // If both word and replacementWord are provided, they must be different
      if (data.word && data.replacementWord) {
        return data.word !== data.replacementWord;
      }
      return true;
    },
    {
      message: "replacementWord must be different from word",
      path: ["replacementWord"],
    },
  );

const BulkImportSchema = z.array(
  z.object({
    word: z.string().min(1),
    dateAdded: z.date().optional(),
  }),
);

export const vocabularyRouter = createRouter({
  // Get vocabulary list with pagination and filtering
  getVocabulary: procedure
    .input(GetVocabularySchema)
    .query(async ({ input }) => {
      return await getVocabulary(input);
    }),

  // Get vocabulary count
  getVocabularyCount: procedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      return await getVocabularyCount(input.search);
    }),

  // Get vocabulary by ID
  getVocabularyById: procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await getVocabularyById(input.id);
    }),

  // Get vocabulary by word
  getVocabularyByWord: procedure
    .input(z.object({ word: z.string() }))
    .query(async ({ input }) => {
      return await getVocabularyByWord(input.word);
    }),

  // Search vocabulary
  searchVocabulary: procedure
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
  getMostUsedWords: procedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ input }) => {
      return await getMostUsedWords(input.limit);
    }),

  // Create vocabulary word
  createVocabularyWord: procedure
    .input(CreateVocabularySchema)
    .mutation(async ({ input }) => {
      return await createVocabularyWord(input);
    }),

  // Update vocabulary word
  updateVocabulary: procedure
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
  deleteVocabulary: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return await deleteVocabulary(input.id);
    }),

  // Track word usage
  trackWordUsage: procedure
    .input(z.object({ word: z.string() }))
    .mutation(async ({ input }) => {
      return await trackWordUsage(input.word);
    }),

  // Bulk import vocabulary
  bulkImportVocabulary: procedure
    .input(BulkImportSchema)
    .mutation(async ({ input }) => {
      return await bulkImportVocabulary(input);
    }),
});
