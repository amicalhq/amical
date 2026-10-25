import { VOCABULARY_CLASSIFY_LIMITS } from "@amical/types";

import { normalizeVocabularyKey } from "../../utils/vocabulary-keys";
import type {
  Candidate,
  CandidateExtraction,
  CandidateFilterResult,
  StepCounts,
} from "./types";

// Correction candidates: tokenize the pasted text and the edited region,
// align them with a longest common subsequence, and turn each run of changes
// into a (term, heard) pair. Pure functions; no I/O.

const MAX_SUBSTITUTED_PAIRS = 4;
const MAX_CANDIDATE_TOKENS = 4;
const MIN_TERM_LENGTH = 2;
const { maxTermLength, maxHeardLength, maxCandidates } =
  VOCABULARY_CLASSIFY_LIMITS;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Han, Hiragana or Katakana. Hangul is not included on purpose.
const CJK_RE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]/u;
const EDGE_PUNCTUATION_RE = /^\p{P}+|\p{P}+$/gu;
const LETTER_RE = /\p{L}/u;
const UPPERCASE_OR_DIGIT_RE = /[\p{Lu}\p{Nd}]/u;
const POSSESSIVE_RE = /['’]s$/;

interface Token {
  /** Raw token with edge punctuation removed; case kept. */
  core: string;
  /** Comparison form: NFC, lower case. */
  key: string;
  /** True when whitespace separated this token from the previous one. */
  spaceBefore: boolean;
}

type StepKind = "M" | "C" | "D" | "I";

interface Step {
  kind: StepKind;
  pasted?: Token;
  edited?: Token;
}

interface Run {
  d: number;
  i: number;
  pasted: Token[];
  edited: Token[];
}

// Split on whitespace. Inside a chunk each CJK grapheme is its own token;
// other graphemes stay together. Tokens that are only punctuation are dropped.
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const chunk of text.split(/\s+/)) {
    if (chunk === "") {
      continue;
    }
    let spaceBefore = true;
    let pending = "";
    const push = (raw: string) => {
      const core = raw.replace(EDGE_PUNCTUATION_RE, "");
      if (core === "") {
        return;
      }
      tokens.push({
        core,
        key: core.normalize("NFC").toLowerCase(),
        spaceBefore,
      });
      spaceBefore = false;
    };
    for (const { segment } of graphemes.segment(chunk)) {
      if (CJK_RE.test(segment)) {
        if (pending !== "") {
          push(pending);
          pending = "";
        }
        push(segment);
      } else {
        pending += segment;
      }
    }
    if (pending !== "") {
      push(pending);
    }
  }
  return tokens;
}

/**
 * Word forms as the candidate stage sees them: edge punctuation off, NFC,
 * case kept (a case change is an edit here). Used by the edit tracker.
 */
export function wordForms(text: string): string[] {
  return tokenize(text).map((token) => token.core.normalize("NFC"));
}

// Longest common subsequence over the comparison keys. Ties prefer D (advance
// the pasted side) so a substitution always reads "D... I...".
function align(pasted: Token[], edited: Token[]): Step[] {
  const n = pasted.length;
  const m = edited.length;
  const width = m + 1;
  // lcs[i * width + j] = LCS length of pasted[i..] and edited[j..]
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        pasted[i].key === edited[j].key
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && pasted[i].key === edited[j].key) {
      steps.push({
        kind: pasted[i].core === edited[j].core ? "M" : "C",
        pasted: pasted[i],
        edited: edited[j],
      });
      i++;
      j++;
    } else if (
      j >= m ||
      (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      steps.push({ kind: "D", pasted: pasted[i] });
      i++;
    } else {
      steps.push({ kind: "I", edited: edited[j] });
      j++;
    }
  }
  return steps;
}

// Maximal sequences of steps that are not M. C steps join a run.
function collectRuns(steps: Step[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const step of steps) {
    if (step.kind === "M") {
      current = null;
      continue;
    }
    if (current === null) {
      current = { d: 0, i: 0, pasted: [], edited: [] };
      runs.push(current);
    }
    if (step.kind === "D") {
      current.d++;
    } else if (step.kind === "I") {
      current.i++;
    }
    if (step.pasted) {
      current.pasted.push(step.pasted);
    }
    if (step.edited) {
      current.edited.push(step.edited);
    }
  }
  return runs;
}

function joinTokens(tokens: Token[]): string {
  return tokens
    .map((token, index) =>
      index > 0 && token.spaceBefore ? ` ${token.core}` : token.core,
    )
    .join("");
}

export function extractCandidates(
  pasted: string,
  edited: string,
): CandidateExtraction {
  const pastedTokens = tokenize(pasted);
  const steps = align(pastedTokens, tokenize(edited));

  const counts: StepCounts = { m: 0, c: 0, d: 0, i: 0 };
  for (const step of steps) {
    counts[step.kind.toLowerCase() as keyof StepCounts]++;
  }

  const runs = collectRuns(steps);
  const substitutedPairs = runs.reduce(
    (sum, run) => sum + Math.min(run.d, run.i),
    0,
  );
  // Rewrite: many substitutions and less than half of the pasted tokens kept.
  // When every run deletes as many tokens as it inserts, kept = pasted -
  // substituted and this equals "substituted > half". Runs that delete more
  // than they insert hide deleted tokens from the pairs count: a retype
  // shorter than the paste kept 12% of the words, passed a pairs-only test
  // and produced 7 garbage candidates.
  const rewrite =
    substitutedPairs > MAX_SUBSTITUTED_PAIRS &&
    counts.m + counts.c < pastedTokens.length / 2;
  if (rewrite) {
    return { steps: counts, rewrite, candidates: [] };
  }

  const candidates: Candidate[] = runs
    .filter(
      (run) =>
        run.d >= 1 && run.i >= 1 && run.edited.length <= MAX_CANDIDATE_TOKENS,
    )
    .map((run) => ({
      term: joinTokens(run.edited),
      heard: joinTokens(run.pasted),
    }));

  return { steps: counts, rewrite, candidates };
}

/**
 * Filters in this order: shape, possessive, length, known, CJK, then
 * de-duplicate and cap. `known` holds normalizeVocabularyKey() forms of the
 * vocabulary words, replacement words and snippet triggers.
 */
export function filterCandidates(
  candidates: Candidate[],
  known: ReadonlySet<string>,
): CandidateFilterResult {
  const dropped = {
    shape: 0,
    length: 0,
    known: 0,
    cjk: 0,
    duplicate: 0,
    cap: 0,
  };
  const passing: Candidate[] = [];

  for (const candidate of candidates) {
    if (
      !LETTER_RE.test(candidate.term) ||
      candidate.term.includes("@") ||
      candidate.term.includes("://")
    ) {
      dropped.shape++;
      continue;
    }
    const term = candidate.term.replace(POSSESSIVE_RE, "");
    if (
      term.length < MIN_TERM_LENGTH ||
      term.length > maxTermLength ||
      candidate.heard.length > maxHeardLength
    ) {
      dropped.length++;
      continue;
    }
    if (known.has(normalizeVocabularyKey(term))) {
      dropped.known++;
      continue;
    }
    if (CJK_RE.test(term)) {
      dropped.cjk++;
      continue;
    }
    passing.push({ term, heard: candidate.heard });
  }

  // Candidates with an uppercase letter or a digit win the de-duplication
  // and the cap.
  const preferred = passing.filter((candidate) =>
    UPPERCASE_OR_DIGIT_RE.test(candidate.term),
  );
  const others = passing.filter(
    (candidate) => !UPPERCASE_OR_DIGIT_RE.test(candidate.term),
  );
  const seen = new Set<string>();
  const kept: Candidate[] = [];
  for (const candidate of [...preferred, ...others]) {
    const key = normalizeVocabularyKey(candidate.term);
    if (seen.has(key)) {
      dropped.duplicate++;
      continue;
    }
    if (kept.length >= maxCandidates) {
      dropped.cap++;
      continue;
    }
    seen.add(key);
    kept.push(candidate);
  }

  return { kept, dropped };
}
