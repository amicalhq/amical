const LEADING_HORIZONTAL_SPACE_RE = /^[ \t]+/;
const TRAILING_HORIZONTAL_SPACE_RE = /[ \t]+$/;
const LEADING_NEWLINE_RE = /^[\r\n]+/;
const TRAILING_NEWLINE_RE = /[\r\n]+$/;
const BOUNDARY_WHITESPACE_RE = /[ \t\r\n]$/;
const STARTS_WITH_BOUNDARY_WHITESPACE_RE = /^[ \t\r\n]/;

// Zero-width and invisible format characters. Some apps (e.g. Google Docs)
// inject these as accessibility placeholders, so the captured before/after
// context can be a lone zero-width space even when the cursor is effectively
// at an empty boundary. They have no visible width and never represent real
// content, so they must not drive a spacing decision.
//   U+00AD soft hyphen, U+061C Arabic letter mark, U+180E Mongolian vowel
//   separator, U+200B-U+200F zero-width space/joiners + LRM/RLM, U+202A-U+202E
//   bidi embeddings/overrides, U+2060-U+206F word joiner/invisible operators/
//   bidi isolates/deprecated format chars, U+FEFF BOM (zero-width no-break space).
const IGNORABLE_FORMAT_CHARS_RE =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

function stripIgnorableFormatChars(text: string): string {
  return text.replace(IGNORABLE_FORMAT_CHARS_RE, "");
}

const ASCII_PUNCTUATION = new Set(
  Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'),
);
const OPENING_PUNCTUATION = new Set(Array.from('([{<"\'`“‘¿¡《〈「『【〔（［｛'));

function codePointInRanges(
  codePoint: number,
  ranges: readonly (readonly [number, number])[],
): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

const NO_SPACE_SCRIPT_RANGES = [
  [0x0e00, 0x0e7f], // Thai
  [0x0e80, 0x0eff], // Lao
  [0x1000, 0x109f], // Myanmar
  [0xaa60, 0xaa7f], // Myanmar Extended-A
  [0xa9e0, 0xa9ff], // Myanmar Extended-B
  [0x1780, 0x17ff], // Khmer
  [0x19e0, 0x19ff], // Khmer symbols
  [0x3000, 0x303f], // CJK punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x31f0, 0x31ff], // Katakana phonetic extensions
  [0x3100, 0x312f], // Bopomofo
  [0x31a0, 0x31bf], // Bopomofo Extended
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xff00, 0xffef], // Halfwidth and fullwidth forms
  [0x20000, 0x2a6df], // CJK Extension B
  [0x2a700, 0x2b73f], // CJK Extension C
  [0x2b740, 0x2b81f], // CJK Extension D
  [0x2b820, 0x2ceaf], // CJK Extension E/F
  [0x2ceb0, 0x2ebef], // CJK Extension G/H
  [0x2f800, 0x2fa1f], // CJK Compatibility Supplement
  [0x30000, 0x3134f], // CJK Extension G+
] as const;

const PUNCTUATION_SYMBOL_RANGES = [
  [0x05c3, 0x05c3], // Hebrew sof pasuq
  [0x05f3, 0x05f4], // Hebrew geresh and gershayim
  [0x060c, 0x060c], // Arabic comma
  [0x061b, 0x061b], // Arabic semicolon
  [0x061f, 0x061f], // Arabic question mark
  [0x0964, 0x0965], // Devanagari danda and double danda
  [0x2000, 0x206f], // General punctuation
  [0x20a0, 0x20cf], // Currency symbols
  [0x2100, 0x214f], // Letterlike symbols
  [0x2190, 0x22ff], // Arrows and math operators
  [0x2600, 0x27bf], // Misc symbols and dingbats
  [0x2e00, 0x2e7f], // Supplemental punctuation
  [0x1f000, 0x1faff], // Emoji and supplemental symbols
  [0x3000, 0x303f], // CJK punctuation
  [0xfe10, 0xfe1f], // Vertical forms
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xff65], // Fullwidth punctuation and halfwidth katakana punctuation
] as const;

function isBoundaryWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function firstBoundaryChar(text: string): string | undefined {
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      return undefined;
    }

    const char = String.fromCodePoint(codePoint);
    if (!isBoundaryWhitespace(char)) {
      return char;
    }

    index += char.length;
  }

  return undefined;
}

function previousCodePointChar(
  text: string,
  endIndex: number,
): { char: string; start: number } | undefined {
  if (endIndex <= 0) {
    return undefined;
  }

  let start = endIndex - 1;
  const codeUnit = text.charCodeAt(start);
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff && start > 0) {
    const previousCodeUnit = text.charCodeAt(start - 1);
    if (previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff) {
      start -= 1;
    }
  }

  return { char: text.slice(start, endIndex), start };
}

function lastBoundaryChar(text: string): string | undefined {
  for (let end = text.length; end > 0; ) {
    const previous = previousCodePointChar(text, end);
    if (!previous) {
      return undefined;
    }

    if (!isBoundaryWhitespace(previous.char)) {
      return previous.char;
    }

    end = previous.start;
  }

  return undefined;
}

function lastContentChar(text: string): string | undefined {
  for (let end = text.length; end > 0; ) {
    const previous = previousCodePointChar(text, end);
    if (!previous) {
      return undefined;
    }

    if (
      !isBoundaryWhitespace(previous.char) &&
      !isPunctuationOrSymbol(previous.char)
    ) {
      return previous.char;
    }

    end = previous.start;
  }

  return undefined;
}

function isNoSpaceScript(char: string | undefined): boolean {
  if (!char) {
    return false;
  }

  const codePoint = char.codePointAt(0);
  return (
    codePoint !== undefined &&
    codePointInRanges(codePoint, NO_SPACE_SCRIPT_RANGES)
  );
}

function isPunctuationOrSymbol(char: string | undefined): boolean {
  if (!char) {
    return false;
  }

  if (ASCII_PUNCTUATION.has(char)) {
    return true;
  }

  const codePoint = char.codePointAt(0);
  return (
    codePoint !== undefined &&
    codePointInRanges(codePoint, PUNCTUATION_SYMBOL_RANGES)
  );
}

function endsInNoSpaceScript(text: string): boolean {
  // Check both views: the last non-punctuation content char handles "你好。",
  // while the literal boundary char handles no-space fullwidth/CJK marks.
  return (
    isNoSpaceScript(lastContentChar(text)) ||
    isNoSpaceScript(lastBoundaryChar(text))
  );
}

function startsWithNoSpaceScript(text: string): boolean {
  return isNoSpaceScript(firstBoundaryChar(text));
}

function shouldSeparateWithSpace(leftText: string, rightText: string): boolean {
  const leftChar = lastBoundaryChar(leftText);
  const rightChar = firstBoundaryChar(rightText);

  if (!leftChar || !rightChar) {
    return false;
  }

  if (endsInNoSpaceScript(leftText) || startsWithNoSpaceScript(rightText)) {
    return false;
  }

  if (isPunctuationOrSymbol(rightChar) || OPENING_PUNCTUATION.has(leftChar)) {
    return false;
  }

  return true;
}

function shouldDefaultTrailingSpace(text: string): boolean {
  return Boolean(lastBoundaryChar(text)) && !endsInNoSpaceScript(text);
}

function stripLeadingSpaces(text: string): string {
  return text.replace(LEADING_HORIZONTAL_SPACE_RE, "");
}

function stripTrailingSpaces(text: string): string {
  return text.replace(TRAILING_HORIZONTAL_SPACE_RE, "");
}

function ensureLeadingSpace(text: string): string {
  return LEADING_HORIZONTAL_SPACE_RE.test(text)
    ? text.replace(LEADING_HORIZONTAL_SPACE_RE, " ")
    : ` ${text}`;
}

function ensureTrailingSpace(text: string): string {
  return `${stripTrailingSpaces(text)} `;
}

/**
 * Normalizes the leading/trailing whitespace of a transcription based on its
 * insertion context (the text immediately before and after the cursor).
 *
 * Leading: strips leading newlines (never wanted inline), then collapses or
 * adds a single leading space so there is exactly one separator between
 * `beforeText` and the transcription (and none when the script does not use
 * spaces or the boundary is punctuation).
 *
 * Trailing: trims trailing newlines/spaces, then appends a single trailing
 * space for space-separated scripts when appropriate. Skips the space if
 * `afterText` already starts with whitespace/punctuation or either side uses a
 * script that conventionally does not separate words with spaces.
 *
 * Pass `null`/`undefined` for an unknown edge to skip that side's handling.
 */
export function normalizeTranscriptionBoundaries(
  text: string,
  beforeText: string | null | undefined,
  afterText: string | null | undefined,
): string {
  let result = text
    .replace(LEADING_NEWLINE_RE, "")
    .replace(TRAILING_NEWLINE_RE, "");

  if (result.trim().length === 0) {
    return result;
  }

  // Drop zero-width/invisible format characters so an app-injected placeholder
  // (e.g. Google Docs' lone zero-width space) collapses to an empty boundary
  // rather than reading as real preceding/following content.
  const before =
    beforeText === null || beforeText === undefined
      ? beforeText
      : stripIgnorableFormatChars(beforeText);
  const after =
    afterText === null || afterText === undefined
      ? afterText
      : stripIgnorableFormatChars(afterText);

  if (before !== null && before !== undefined) {
    if (before === "" || BOUNDARY_WHITESPACE_RE.test(before)) {
      result = stripLeadingSpaces(result);
    } else if (shouldSeparateWithSpace(before, result)) {
      result = ensureLeadingSpace(result);
    } else {
      result = stripLeadingSpaces(result);
    }
  }

  if (after !== null && after !== undefined) {
    if (after === "") {
      result = shouldDefaultTrailingSpace(result)
        ? ensureTrailingSpace(result)
        : stripTrailingSpaces(result);
    } else if (STARTS_WITH_BOUNDARY_WHITESPACE_RE.test(after)) {
      result = stripTrailingSpaces(result);
    } else if (shouldSeparateWithSpace(result, after)) {
      result = ensureTrailingSpace(result);
    } else {
      result = stripTrailingSpaces(result);
    }
  } else {
    result = shouldDefaultTrailingSpace(result)
      ? ensureTrailingSpace(result)
      : stripTrailingSpaces(result);
  }

  return result;
}
