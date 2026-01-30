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

  for (const [word, replacement] of replacements) {
    // Escape special regex characters in the word
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasCJK = cjkPattern.test(word);

    if (hasCJK) {
      // CJK: Simple case-insensitive replacement (no word boundaries)
      // Japanese/Chinese/Korean text has no spaces between words
      const regex = new RegExp(escapedWord, "giu");
      result = result.replace(regex, replacement);
    } else {
      // Alphabetic languages: Use Unicode-aware word boundary matching
      // Negative lookbehind/lookahead ensures word is not part of a larger word
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapedWord}(?![\\p{L}\\p{N}])`,
        "giu",
      );
      result = result.replace(regex, replacement);
    }
  }

  return result;
}
