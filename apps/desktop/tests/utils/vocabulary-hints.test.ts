import { describe, expect, it } from "vitest";
import type { Vocabulary } from "../../src/db/schema";
import {
  MAX_VOCABULARY_HINTS,
  selectVocabularyHints,
} from "../../src/utils/vocabulary-hints";

function entry(
  word: string,
  dateAdded: number,
  source: "manual" | "auto" = "manual",
  replacementWord: string | null = null,
): Vocabulary {
  return {
    word,
    dateAdded: new Date(dateAdded),
    source,
    replacementWord,
  } as Vocabulary;
}

function manualWords(count: number, newestFirstFrom = 1_000_000): Vocabulary[] {
  return Array.from({ length: count }, (_, i) =>
    entry(`m${i}`, newestFirstFrom - i),
  );
}

describe("selectVocabularyHints", () => {
  it("keeps the newest-first list, without replacements, for users with no learned words", () => {
    const entries = [
      entry("old", 1),
      entry("new", 3),
      entry("mid", 2),
      entry("typo", 4, "manual", "fixed"),
      ...manualWords(MAX_VOCABULARY_HINTS, 10_000),
    ];
    const hints = selectVocabularyHints(entries);
    expect(hints).toHaveLength(MAX_VOCABULARY_HINTS);
    expect(hints[0]).toBe("m0");
    expect(hints).not.toContain("typo");
    expect(hints).not.toContain("old");
  });

  it("sends learned words first, each group newest first", () => {
    const hints = selectVocabularyHints([
      entry("manualOld", 1),
      entry("learnedOld", 2, "auto"),
      entry("manualNew", 3),
      entry("learnedNew", 4, "auto"),
    ]);
    expect(hints).toEqual([
      "learnedNew",
      "learnedOld",
      "manualNew",
      "manualOld",
    ]);
  });

  it("never lets a learned word push a manual word out of the cap", () => {
    const full = selectVocabularyHints([
      ...manualWords(MAX_VOCABULARY_HINTS),
      entry("learned", 2_000_000, "auto"),
    ]);
    expect(full).toHaveLength(MAX_VOCABULARY_HINTS);
    expect(full).not.toContain("learned");

    const oneSlot = selectVocabularyHints([
      ...manualWords(MAX_VOCABULARY_HINTS - 1),
      entry("learnedOld", 2_000_000, "auto"),
      entry("learnedNew", 2_000_001, "auto"),
    ]);
    expect(oneSlot).toHaveLength(MAX_VOCABULARY_HINTS);
    expect(oneSlot[0]).toBe("learnedNew");
    expect(oneSlot).not.toContain("learnedOld");
  });
});
