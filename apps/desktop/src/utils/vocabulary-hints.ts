import type { Vocabulary } from "../db/schema";

/**
 * Max non-replacement vocabulary entries fed into the LLM formatter as hints.
 * Storage and UI are uncapped; this limit applies only to what's sent in the
 * prompt during transcription so the prompt stays bounded.
 */
export const MAX_VOCABULARY_HINTS = 200;

/**
 * Pick the vocabulary entries to surface to the LLM as hints during
 * transcription. Filters out replacement-mode entries (those run through the
 * post-format `applyTextReplacements` path instead) and caps the result.
 *
 * Selection: manual words first (newest first), then learned words (newest
 * first), 200 in total — learned words never push a manual word out.
 * Order sent: learned words first, then manual. Prompt truncation cuts from
 * the start of the list, so it drops learned words before manual ones. A user
 * with no learned words gets the same list and order as before.
 *
 * TODO: Replace the naive "latest N by date" heuristic with smarter ranking —
 * frequency-weighted (usageCount), context-aware, or LLM-pre-selection — once
 * we have signal to drive that. For now most-recent wins.
 */
export function selectVocabularyHints(entries: Vocabulary[]): string[] {
  const newestFirst = entries
    .filter((e) => e.replacementWord === null)
    .sort((a, b) => b.dateAdded.getTime() - a.dateAdded.getTime());
  const manual = newestFirst
    .filter((e) => e.source !== "auto")
    .slice(0, MAX_VOCABULARY_HINTS);
  const learned = newestFirst
    .filter((e) => e.source === "auto")
    .slice(0, MAX_VOCABULARY_HINTS - manual.length);
  return [...learned, ...manual].map((e) => e.word);
}
