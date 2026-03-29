const DEFAULT_WORD_COUNT_LOCALE = "en";

const NON_STANDARD_LOCALE_ALIASES: Record<string, string> = {
  auto: DEFAULT_WORD_COUNT_LOCALE,
  english: "en",
  japanese: "ja",
  chinese: "zh",
  "traditional chinese": "zh-TW",
  "simplified chinese": "zh-CN",
  mandarin: "zh",
  cantonese: "yue",
  korean: "ko",
  thai: "th",
  spanish: "es",
  french: "fr",
  german: "de",
  portuguese: "pt",
  "brazilian portuguese": "pt-BR",
};

function countWordsByWhitespace(trimmedText: string): number {
  return trimmedText.split(/\s+/).length;
}

function canonicalizeLocale(locale: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

function normalizeWordCountLocale(languageHint?: string | null): string {
  const trimmedHint = languageHint?.trim();
  if (!trimmedHint) {
    return DEFAULT_WORD_COUNT_LOCALE;
  }

  const normalizedHint = trimmedHint.replace(/_/g, "-");
  const lowerHint = normalizedHint.toLowerCase();
  const candidates = [
    normalizedHint,
    NON_STANDARD_LOCALE_ALIASES[lowerHint],
    normalizedHint.split("-")[0],
    NON_STANDARD_LOCALE_ALIASES[lowerHint]?.split("-")[0],
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const canonicalLocale = canonicalizeLocale(candidate);
    if (canonicalLocale) {
      return canonicalLocale;
    }
  }

  return DEFAULT_WORD_COUNT_LOCALE;
}

export function countWords(text: string, languageHint?: string | null): number {
  try {
    const trimmed = text.trim();
    if (!trimmed) {
      return 0;
    }

    const locale = normalizeWordCountLocale(languageHint);
    const segmenter = new Intl.Segmenter(locale, { granularity: "word" });

    let count = 0;
    for (const segment of segmenter.segment(trimmed)) {
      if (segment.isWordLike) {
        count += 1;
      }
    }

    return count;
  } catch {
    const trimmed = text.trim();
    if (!trimmed) {
      return 0;
    }

    return countWordsByWhitespace(trimmed);
  }
}

export function toLocalStatsDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
