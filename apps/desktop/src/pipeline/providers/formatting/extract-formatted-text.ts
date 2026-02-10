type ExtractionFailureReason =
  | "malformed_tags"
  | "no_tags"
  | "empty_content"
  | "whitespace_only";

export type ExtractionResult = {
  text: string;
  usedFallback: boolean;
  reason?: ExtractionFailureReason;
};

/**
 * Extract formatted text from LLM response with safety fallback.
 * If extraction fails (malformed tags, empty content, etc.), returns original text.
 */
export function extractFormattedText(
  response: string,
  originalText: string,
): ExtractionResult {
  const hasOpenTag = response.includes("<formatted_text>");
  const hasCloseTag = response.includes("</formatted_text>");

  if (hasOpenTag && !hasCloseTag) {
    return { text: originalText, usedFallback: true, reason: "malformed_tags" };
  }

  const match = response.match(/<formatted_text>([\s\S]*?)<\/formatted_text>/);
  if (!match) {
    return { text: originalText, usedFallback: true, reason: "no_tags" };
  }

  const extracted = match[1] ?? "";
  if (extracted.trim() === "") {
    return {
      text: originalText,
      usedFallback: true,
      reason: extracted === "" ? "empty_content" : "whitespace_only",
    };
  }

  return { text: extracted, usedFallback: false };
}
