import { z } from 'zod';

/**
 * Vocabulary learning: term check.
 *
 * POST /apps/v1/vocabulary/classify
 *
 * The desktop sends words a user typed over a dictation ("term") with what the
 * transcript said ("heard"). The server answers which terms are names or
 * domain terms worth adding to the user's vocabulary.
 */

export const VOCABULARY_CLASSIFY_LIMITS = {
  maxCandidates: 4,
  maxTermLength: 60,
  maxHeardLength: 120,
  maxLanguageLength: 35,
} as const;

export const VocabularyClassifyCandidateSchema = z
  .object({
    term: z.string().trim().min(1).max(VOCABULARY_CLASSIFY_LIMITS.maxTermLength),
    heard: z.string().trim().min(1).max(VOCABULARY_CLASSIFY_LIMITS.maxHeardLength),
  })
  .strict();
export type VocabularyClassifyCandidate = z.output<typeof VocabularyClassifyCandidateSchema>;

export const VocabularyClassifyRequestSchema = z
  .object({
    candidates: z
      .array(VocabularyClassifyCandidateSchema)
      .min(1)
      .max(VOCABULARY_CLASSIFY_LIMITS.maxCandidates),
    language: z.string().min(1).max(VOCABULARY_CLASSIFY_LIMITS.maxLanguageLength).optional(),
  })
  .strict();
export type VocabularyClassifyRequest = z.output<typeof VocabularyClassifyRequestSchema>;

/**
 * `accepted` is always a subset of the request terms, with the exact strings.
 * `disabled` is true when the feature switch is off for the caller; then
 * `accepted` is empty. Clients must ignore unknown fields so that new fields
 * can be added without breaking released apps.
 */
export const VocabularyClassifyResponseSchema = z
  .object({
    accepted: z.array(z.string()),
    disabled: z.boolean().optional(),
  })
  .strip();
export type VocabularyClassifyResponse = z.output<typeof VocabularyClassifyResponseSchema>;
