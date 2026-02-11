import { HALLUCINATION_PHRASES } from "../../data/hallucination-phrases";

/** Lower threshold for known hallucination phrases */
const HALLUCINATION_THRESHOLD = 0.4;

/**
 * Normalizes text for hallucination lookup:
 * - Unicode NFC normalization
 * - Lowercase
 * - Trimmed whitespace
 */
function normalizeText(text: string): string {
  return text.normalize("NFC").toLowerCase().trim();
}

/**
 * Checks if text matches a known hallucination phrase
 */
function isKnownHallucination(text: string): boolean {
  return HALLUCINATION_PHRASES.has(normalizeText(text));
}

interface Segment {
  text: string;
  noSpeechProb?: number;
}

/**
 * Determines if a segment should be dropped based on quality metrics.
 * Rules:
 * 1. noSpeechProb > 0.8 → drop (high confidence no speech)
 * 2. noSpeechProb > 0.4 AND text is a known hallucination phrase → drop
 */
export function shouldDropSegment(segment: Segment): boolean {
  // Rule 1: High noSpeechProb
  if (segment.noSpeechProb !== undefined && segment.noSpeechProb > 0.8) {
    return true;
  }

  // Rule 2: Lower threshold for known hallucination phrases
  if (
    segment.noSpeechProb !== undefined &&
    segment.noSpeechProb > HALLUCINATION_THRESHOLD &&
    isKnownHallucination(segment.text)
  ) {
    return true;
  }

  return false;
}
