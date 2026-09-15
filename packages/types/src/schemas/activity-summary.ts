import { z } from "zod";

// Structural copy of the Apps V1 activity summary response contract.
export const DictationActivitySummarySchema = z.object({
  totals: z.object({
    activities: z.number().int().nonnegative(),
    words: z.number().int().nonnegative(),
    wordsWithAudioDuration: z.number().int().nonnegative(),
    audioDurationMs: z.number().int().positive().nullable(),
  }),
});

export type DictationActivitySummary = z.output<
  typeof DictationActivitySummarySchema
>;
