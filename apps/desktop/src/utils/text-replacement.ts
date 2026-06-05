/**
 * Apply vocabulary replacements to text.
 * Uses word boundaries for alphabetic languages, simple replacement for CJK.
 *
 * @param text - The text to apply replacements to
 * @param replacements - Map of words to their replacements
 * @returns The text with replacements applied
 */
export function applyTextReplacements(
  text: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0 || !text) {
    return text;
  }

  let result = text;

  // CJK character detection: Han (Chinese/Japanese Kanji), Hiragana, Katakana, Hangul (Korean)
  const cjkPattern =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

  // Apply longest triggers first so a shorter trigger doesn't consume a substring
  // of a longer one (e.g. `link` must not fire before `meeting link`). Map iterates
  // in insertion order, so without this sort, behavior would depend on creation order.
  const sortedEntries = [...replacements].sort(
    ([a], [b]) => b.length - a.length,
  );

  for (const [word, replacement] of sortedEntries) {
    // Escape special regex characters in the word
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Escape `$` in the replacement so $& / $1 / $$ / $` / $' aren't
    // interpreted as backreferences by String.prototype.replace.
    const literalReplacement = replacement.replace(/\$/g, "$$$$");
    const hasCJK = cjkPattern.test(word);

    if (hasCJK) {
      // CJK: Simple case-insensitive replacement (no word boundaries)
      // Japanese/Chinese/Korean text has no spaces between words
      const regex = new RegExp(escapedWord, "giu");
      result = result.replace(regex, literalReplacement);
    } else {
      // Alphabetic languages: Use Unicode-aware word boundary matching
      // Negative lookbehind/lookahead ensures word is not part of a larger word
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapedWord}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      result = result.replace(regex, literalReplacement);
    }
  }

  return result;
}

/**
 * Replace the German sharp s with its Swiss Standard German spelling.
 *
 * Swiss Standard German (Switzerland and Liechtenstein) does not use the
 * sharp s at all: every ß is written ss. Because the sharp s only ever
 * appears inside words, the word-boundary matching in applyTextReplacements
 * cannot express this rule, so it gets its own character-level pass.
 */
export function applySwissGermanSpelling(text: string): string {
  if (!text) {
    return text;
  }
  return text.replace(/\u00df/gu, "ss").replace(/\u1e9e/gu, "SS");
}
