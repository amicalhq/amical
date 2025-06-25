import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import {
  getTranscriptions,
  getTranscriptionById,
  createTranscription,
  updateTranscription,
  deleteTranscription,
  getTranscriptionsCount,
  searchTranscriptions,
} from '../../db/transcriptions.js';

const t = initTRPC.create({
  isServer: true,
  transformer: superjson,
});

// Input schemas
const GetTranscriptionsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(['id', 'timestamp', 'text', 'language']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
});

const CreateTranscriptionSchema = z.object({
  text: z.string(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

const UpdateTranscriptionSchema = z.object({
  text: z.string().optional(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

export const transcriptionsRouter = t.router({
  // Get transcriptions list with pagination and filtering
  getTranscriptions: t.procedure.input(GetTranscriptionsSchema).query(async ({ input }) => {
    return await getTranscriptions(input);
  }),

  // Get transcriptions count
  getTranscriptionsCount: t.procedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      return await getTranscriptionsCount(input.search);
    }),

  // Get transcription by ID
  getTranscriptionById: t.procedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return await getTranscriptionById(input.id);
  }),

  // Search transcriptions
  searchTranscriptions: t.procedure
    .input(
      z.object({
        searchTerm: z.string(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      return await searchTranscriptions(input.searchTerm, input.limit);
    }),

  // Create transcription
  createTranscription: t.procedure.input(CreateTranscriptionSchema).mutation(async ({ input }) => {
    return await createTranscription(input);
  }),

  // Update transcription
  updateTranscription: t.procedure
    .input(
      z.object({
        id: z.number(),
        data: UpdateTranscriptionSchema,
      })
    )
    .mutation(async ({ input }) => {
      return await updateTranscription(input.id, input.data);
    }),

  // Delete transcription
  deleteTranscription: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return await deleteTranscription(input.id);
  }),
}); 