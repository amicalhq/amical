import { stripIgnorableFormatChars } from "../../utils/boundary-spacing";
import { align, isKept, tokenize, type Step } from "./candidates";
import { graphemeList, levenshtein } from "./edit-tracker";

// Edit metrics: how much the user changed a pasted dictation, as counts and
// enums for telemetry. Pure functions; no I/O. Text never leaves this module.

export type EditChangeKind =
  | "none"
  | "spacing_or_punctuation"
  | "case"
  | "added"
  | "corrected";

/**
 * Telemetry property names. Words are alignment tokens: whitespace-separated
 * words, and one token per character in Chinese and Japanese.
 */
export interface PastedSize {
  pasted_char_count: number;
  pasted_word_count: number;
}

export interface EditMetrics extends PastedSize {
  final_char_count: number;
  final_word_count: number;
  /** Grapheme edit distance. Absent when char_edit_count_capped is set. */
  char_edit_count?: number;
  char_edit_count_capped?: true;
  matched_word_count: number;
  case_only_word_count: number;
  substituted_word_count: number;
  deleted_word_count: number;
  /** Added between kept words: most often a word the dictation dropped. */
  inserted_word_count: number;
  /** Added before or after the dictated text: not a correction. */
  prepended_word_count: number;
  appended_word_count: number;
  /**
   * Kept words whose leading or trailing punctuation changed. Marks that
   * stand alone (CJK punctuation, space-separated marks) are on no word:
   * only char_edit_count sees them.
   */
  punctuation_changed_word_count: number;
  correction_run_count: number;
  change_kind: EditChangeKind;
}

// Host apps and input methods change glyphs without changing words: curly
// apostrophes and quotes (smart quotes), full-width digits and Latin letters
// (an input-method mode), invisible format characters and U+FFFC (an inline
// attachment). Full-width punctuation is the normal form in Chinese and
// stays. Whitespace runs collapse: line endings and spacing differ by app.
const APOSTROPHES_RE = /[\u2018\u2019\u02BC]/g;
const DOUBLE_QUOTES_RE = /[\u201C\u201D\u201E]/g;
const FULL_WIDTH_ALPHANUMERIC_RE = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g;
const FULL_WIDTH_OFFSET = 0xfee0;

function normalize(text: string): string {
  return stripIgnorableFormatChars(text.normalize("NFC"))
    .replace(APOSTROPHES_RE, "'")
    .replace(DOUBLE_QUOTES_RE, '"')
    .replace(FULL_WIDTH_ALPHANUMERIC_RE, (char) =>
      String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET),
    )
    .replace(/\uFFFC/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function pastedSize(pasted: string): PastedSize {
  const text = normalize(pasted);
  return {
    pasted_char_count: graphemeList(text).length,
    pasted_word_count: tokenize(text).length,
  };
}

// A run is a maximal sequence of D and I steps; kept words (M, C) separate
// runs. A run is at the trailing edge when no kept word comes after it (also
// when nothing was kept), and at the leading edge when it starts the text and
// is not trailing. In each run min(d, i) pairs are substitutions; the rest
// are deletions or additions.
function countAlignedWords(steps: Step[], metrics: EditMetrics): void {
  const kept = steps.flatMap((step, index) => (isKept(step) ? [index] : []));
  const firstKept = kept.length > 0 ? kept[0] : steps.length;
  const lastKept = kept.length > 0 ? kept[kept.length - 1] : -1;

  let index = 0;
  while (index < steps.length) {
    if (isKept(steps[index])) {
      index++;
      continue;
    }
    const start = index;
    let d = 0;
    let i = 0;
    while (index < steps.length && !isKept(steps[index])) {
      if (steps[index].kind === "D") d++;
      else i++;
      index++;
    }
    const trailing = start > lastKept;
    const leading = !trailing && start === 0;
    const pairs = Math.min(d, i);
    metrics.substituted_word_count += pairs;
    metrics.deleted_word_count += d - pairs;
    if (leading) metrics.prepended_word_count += i - pairs;
    else if (trailing) metrics.appended_word_count += i - pairs;
    else metrics.inserted_word_count += i - pairs;
    // The run removed dictated words, or added words inside the text.
    if (d > 0 || (i > 0 && !leading && !trailing)) metrics.correction_run_count++;
  }

  // Junction: text added or removed at an edge forces a change on the next
  // kept word, such as a lower-case first word after a prepend or a period
  // moved by an append. It says nothing about the dictation.
  for (const keptIndex of kept) {
    const { kind, pasted, edited } = steps[keptIndex];
    if (!pasted || !edited) continue;
    const leadingJunction = keptIndex === firstKept && keptIndex > 0;
    const trailingJunction =
      keptIndex === lastKept && keptIndex < steps.length - 1;
    if (kind === "C" && !leadingJunction) metrics.case_only_word_count++;
    else metrics.matched_word_count++;
    if (
      (!leadingJunction && pasted.leading !== edited.leading) ||
      (!trailingJunction && pasted.trailing !== edited.trailing)
    ) {
      metrics.punctuation_changed_word_count++;
    }
  }
}

function changeKind(metrics: EditMetrics): EditChangeKind {
  if (metrics.correction_run_count > 0) return "corrected";
  if (metrics.case_only_word_count > 0) return "case";
  if (metrics.prepended_word_count + metrics.appended_word_count > 0) {
    return "added";
  }
  return "spacing_or_punctuation";
}

/** Counts that compare the pasted text with the user's final version. */
export function measureEdits(pasted: string, final: string): EditMetrics {
  const pastedText = normalize(pasted);
  const finalText = normalize(final);
  const pastedGraphemes = graphemeList(pastedText);
  const finalGraphemes = graphemeList(finalText);
  const pastedTokens = tokenize(pastedText);
  const finalTokens = tokenize(finalText);
  const metrics: EditMetrics = {
    pasted_char_count: pastedGraphemes.length,
    pasted_word_count: pastedTokens.length,
    final_char_count: finalGraphemes.length,
    final_word_count: finalTokens.length,
    matched_word_count: 0,
    case_only_word_count: 0,
    substituted_word_count: 0,
    deleted_word_count: 0,
    inserted_word_count: 0,
    prepended_word_count: 0,
    appended_word_count: 0,
    punctuation_changed_word_count: 0,
    correction_run_count: 0,
    change_kind: "none",
  };
  const distance = levenshtein(pastedGraphemes, finalGraphemes);
  if (distance === null) metrics.char_edit_count_capped = true;
  else metrics.char_edit_count = distance;
  // Equal texts align as all matches: both steps skip the common prefix.
  countAlignedWords(align(pastedTokens, finalTokens), metrics);
  if (pastedText !== finalText) metrics.change_kind = changeKind(metrics);
  return metrics;
}
