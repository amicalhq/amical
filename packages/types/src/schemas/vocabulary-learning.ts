import { z } from "zod";

// =============================================================================
// Vocabulary learning - term check HTTP contract
// =============================================================================
// POST {CORE_API_URL}/apps/v1/vocabulary/classify
// The desktop sends the words a user typed over a dictation ("term") with what
// the transcript said ("heard"). The server answers which terms are worth
// adding to the user's vocabulary. Mirrors the server contract.
// =============================================================================

export const VOCABULARY_CLASSIFY_LIMITS = {
  maxCandidates: 4,
  maxTermLength: 60,
  maxHeardLength: 120,
  maxLanguageLength: 35,
} as const;

export const VocabularyClassifyCandidateSchema = z
  .object({
    term: z.string().trim().min(1).max(VOCABULARY_CLASSIFY_LIMITS.maxTermLength),
    heard: z
      .string()
      .trim()
      .min(1)
      .max(VOCABULARY_CLASSIFY_LIMITS.maxHeardLength),
  })
  .strict();
export type VocabularyClassifyCandidate = z.infer<
  typeof VocabularyClassifyCandidateSchema
>;

export const VocabularyClassifyRequestSchema = z
  .object({
    candidates: z
      .array(VocabularyClassifyCandidateSchema)
      .min(1)
      .max(VOCABULARY_CLASSIFY_LIMITS.maxCandidates),
    language: z
      .string()
      .min(1)
      .max(VOCABULARY_CLASSIFY_LIMITS.maxLanguageLength)
      .optional(),
  })
  .strict();
export type VocabularyClassifyRequest = z.infer<
  typeof VocabularyClassifyRequestSchema
>;

// Lenient on purpose: unknown fields are dropped, so the server can add fields
// (for example a check id) without breaking released desktops.
export const VocabularyClassifyResponseSchema = z.object({
  accepted: z.array(z.string()),
  disabled: z.boolean().optional(),
});
export type VocabularyClassifyResponse = z.infer<
  typeof VocabularyClassifyResponseSchema
>;
