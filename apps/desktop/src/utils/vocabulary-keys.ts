import type { Vocabulary } from "../db/schema";

/** Comparison form of a vocabulary word: NFKC, lower case, trimmed. */
export function normalizeVocabularyKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

/** Comparison forms of each row's word and replacement word. */
export function vocabularyKeys(
  rows: Iterable<Pick<Vocabulary, "word" | "replacementWord">>,
): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(normalizeVocabularyKey(row.word));
    if (row.replacementWord) {
      keys.add(normalizeVocabularyKey(row.replacementWord));
    }
  }
  return keys;
}
