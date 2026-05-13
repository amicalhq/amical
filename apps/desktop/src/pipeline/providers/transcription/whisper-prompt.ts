/**
 * Build the `initial_prompt` / `prompt` string passed to Whisper.
 *
 * Ported from axis (`@axis/inference`) so local + cloud transcription share
 * the same conditioning shape: vocabulary at the start, prior-text tail at
 * the end, with byte budgets that keep us under Whisper's ~224-token decoder
 * prefix and Groq's 896-byte cap.
 */

/**
 * Max UTF-8 bytes for the Whisper `prompt` field.
 *
 * Groq enforces a 896-byte cap (their error message says "characters" but
 * counts UTF-8 bytes). 896 ≈ 224 decoder-prefix tokens for ASCII, which is
 * Whisper's own `n_text_ctx / 2` cap. whisper.cpp drops leading tokens past
 * that cap silently, so anything we want to survive must sit at the tail.
 *
 * 800 leaves headroom for form-encoding overhead and CJK/emoji where 1 token
 * ≈ 3-4 bytes (whisper.cpp would still drop overflow, but the byte budget
 * keeps the situation predictable).
 */
export const MAX_PROMPT_BYTES = 800;
export const MAX_PREVIOUS_CONTEXT_BYTES = 60;

/** Default trailing word count from prior transcription. Too much prior
 * context causes Whisper to drift / hallucinate ("...as I was saying..."),
 * too little loses punctuation/capitalization continuity. */
export const DEFAULT_PREVIOUS_WORD_COUNT = 10;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function truncateUtf8Tail(s: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(s);
  if (encoded.length <= maxBytes) return s;

  // Drop leading bytes so the tail fits. Then skip any UTF-8 continuation
  // bytes (0b10xxxxxx) at the cut site to land on a character boundary.
  let start = encoded.length - maxBytes;
  while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) {
    start++;
  }
  return new TextDecoder().decode(encoded.subarray(start));
}

/**
 * - Collapse all whitespace to single spaces (atypical whitespace causes the
 *   multilingual tokenizer to hallucinate, e.g. emit Chinese characters).
 * - Truncate from the START to `MAX_PROMPT_BYTES` UTF-8 bytes — Whisper keeps
 *   the tail (last ~224 tokens after `<|startofprev|>`), so the tail is where
 *   hotwords belong. Callers should place important vocabulary at the END.
 * - Preserves UTF-8 boundaries (no replacement chars / mojibake).
 */
export function sanitizeWhisperPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return truncateUtf8Tail(collapsed, MAX_PROMPT_BYTES);
}

export interface BuildWhisperPromptOptions {
  /** Domain vocabulary / hotwords (proper nouns, jargon). Joined with ", ".
   * Placed at the START of the prompt: less critical for continuity than the
   * prior-transcript tail, and if byte truncation hits, the start gets dropped
   * — so the tail (prior transcript) survives. */
  vocabulary?: readonly string[];

  /** Most-recent transcribed text for style / punctuation continuity. Only
   * the last `previousWordCount` words are kept, then capped to
   * `MAX_PREVIOUS_CONTEXT_BYTES`. */
  previousTranscription?: string | null;

  /** Fallback used only when `previousTranscription` is empty. Intended for
   * document context (e.g. text before the cursor in the target app). */
  beforeText?: string | null;

  /** Trailing word count from prior text before byte-budgeting. Defaults to
   * `DEFAULT_PREVIOUS_WORD_COUNT`. */
  previousWordCount?: number;
}

/**
 * Layout: `"<vocab1, vocab2, ...>. <last N words of prior text>"`.
 *
 * Returns `undefined` when there's nothing to prompt with.
 */
export function buildWhisperPrompt(
  opts: BuildWhisperPromptOptions,
): string | undefined {
  const parts: string[] = [];

  if (opts.vocabulary && opts.vocabulary.length > 0) {
    const vocab = opts.vocabulary
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .join(", ");
    if (vocab) parts.push(vocab);
  }

  const source = opts.previousTranscription || opts.beforeText;
  if (source) {
    const words = source.trim().split(/\s+/).filter(Boolean);
    const n = opts.previousWordCount ?? DEFAULT_PREVIOUS_WORD_COUNT;
    const tailWords = words.slice(-n);
    while (
      tailWords.length > 1 &&
      utf8ByteLength(tailWords.join(" ")) > MAX_PREVIOUS_CONTEXT_BYTES
    ) {
      tailWords.shift();
    }

    let tail = tailWords.join(" ");
    if (utf8ByteLength(tail) > MAX_PREVIOUS_CONTEXT_BYTES) {
      tail = truncateUtf8Tail(tail, MAX_PREVIOUS_CONTEXT_BYTES);
    }
    if (tail) parts.push(tail);
  }

  if (parts.length === 0) return undefined;

  // ". " acts as a soft sentence boundary so Whisper doesn't mash the comma
  // list into the prior-transcript tail as one running sentence.
  const sanitized = sanitizeWhisperPrompt(parts.join(". "));
  return sanitized || undefined;
}
