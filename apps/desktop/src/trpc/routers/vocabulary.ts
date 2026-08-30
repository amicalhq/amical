import { z } from "zod";
import { SettingsSyncUuidSchema } from "@amical/types";
import { createRouter, procedure } from "../trpc";
import {
  getVocabulary,
  getVocabularyById,
  getVocabularyByWord,
  createVocabularyWord,
  createOrganizationVocabularyWord,
  updateVocabulary,
  updateOrganizationVocabulary,
  deleteVocabulary,
  deleteOrganizationVocabulary,
  getVocabularyCount,
  searchVocabulary,
  bulkImportVocabulary,
  trackWordUsage,
  getMostUsedWords,
} from "../../db/vocabulary";
import { getActiveOrganizationAccess } from "../../db/sync";
import {
  axisSyncOptionalTextSchema,
  trimmedSyncKeySchema,
} from "../../db/sync-payload";

// Input schemas
const GetVocabularySchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(["word", "dateAdded", "usageCount"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
  scope: z.enum(["all", "user", "org"]).optional(),
});

const CreateVocabularySchema = z
  .object({
    word: trimmedSyncKeySchema,
    replacementWord: axisSyncOptionalTextSchema.nullable().optional(),
  })
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
    word: trimmedSyncKeySchema.optional(),
    replacementWord: axisSyncOptionalTextSchema.nullable().optional(),
  })
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
    word: trimmedSyncKeySchema,
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
    .input(
      z.object({
        search: z.string().optional(),
        scope: z.enum(["all", "user", "org"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      return await getVocabularyCount(input.search, input.scope);
    }),

  getScopeAccess: procedure.query(async () => getActiveOrganizationAccess()),

  // Get vocabulary by ID
  getVocabularyById: procedure
    .input(z.object({ id: SettingsSyncUuidSchema }))
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

  createOrganizationVocabularyWord: procedure
    .input(CreateVocabularySchema)
    .mutation(async ({ input }) => {
      return await createOrganizationVocabularyWord(input);
    }),

  // Update vocabulary word
  updateVocabulary: procedure
    .input(
      z.object({
        id: SettingsSyncUuidSchema,
        data: UpdateVocabularySchema,
      }),
    )
    .mutation(async ({ input }) => {
      return await updateVocabulary(input.id, input.data);
    }),

  updateOrganizationVocabulary: procedure
    .input(
      z.object({
        id: SettingsSyncUuidSchema,
        data: UpdateVocabularySchema,
      }),
    )
    .mutation(async ({ input }) => {
      return await updateOrganizationVocabulary(input.id, input.data);
    }),

  // Delete vocabulary word
  deleteVocabulary: procedure
    .input(z.object({ id: SettingsSyncUuidSchema }))
    .mutation(async ({ input }) => {
      return await deleteVocabulary(input.id);
    }),

  deleteOrganizationVocabulary: procedure
    .input(z.object({ id: SettingsSyncUuidSchema }))
    .mutation(async ({ input }) => {
      return await deleteOrganizationVocabulary(input.id);
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
