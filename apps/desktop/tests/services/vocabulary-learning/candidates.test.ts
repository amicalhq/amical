import { describe, expect, it } from "vitest";

import {
  extractCandidates,
  filterCandidates,
} from "../../../src/services/vocabulary-learning/candidates";
import type { Candidate } from "../../../src/services/vocabulary-learning/types";
import { normalizeVocabularyKey } from "../../../src/utils/vocabulary-keys";

function candidate(term: string, heard = "x"): Candidate {
  return { term, heard };
}

describe("extractCandidates", () => {
  // Golden rows. Steps are given as counts of M / C / D / I.
  const rows: Array<{
    pasted: string;
    edited: string;
    steps: { m: number; c: number; d: number; i: number };
    rewrite?: boolean;
    candidates: Candidate[];
  }> = [
    {
      pasted: "open cloud code and run it",
      edited: "open Claude Code and run it",
      steps: { m: 4, c: 1, d: 1, i: 1 },
      candidates: [{ term: "Claude Code", heard: "cloud code" }],
    },
    {
      pasted: "open cloud code and run it",
      edited: "open Claude Code, and run it",
      steps: { m: 4, c: 1, d: 1, i: 1 },
      candidates: [{ term: "Claude Code", heard: "cloud code" }],
    },
    {
      pasted: "ping the cube flow team",
      edited: "ping the Kubeflow team",
      steps: { m: 3, c: 0, d: 2, i: 1 },
      candidates: [{ term: "Kubeflow", heard: "cube flow" }],
    },
    {
      pasted: "send it to john tomorrow",
      edited: "send it to Jon tomorrow",
      steps: { m: 4, c: 0, d: 1, i: 1 },
      candidates: [{ term: "Jon", heard: "john" }],
    },
    {
      pasted: "we use github",
      edited: "we use GitHub",
      steps: { m: 2, c: 1, d: 0, i: 0 },
      candidates: [],
    },
    {
      pasted: "send it tomorrow",
      edited: "send it to Priya tomorrow",
      steps: { m: 3, c: 0, d: 0, i: 2 },
      candidates: [],
    },
    {
      pasted: "ill take look",
      edited: "I'll take a look",
      steps: { m: 2, c: 0, d: 1, i: 2 },
      candidates: [{ term: "I'll", heard: "ill" }],
    },
    {
      pasted: "can you send me the report by friday",
      edited: "please share the final report with me today",
      steps: { m: 2, c: 0, d: 6, i: 6 },
      candidates: [
        { term: "please share", heard: "can you send me" },
        { term: "with me today", heard: "by friday" },
      ],
    },
    {
      pasted: "send the deck to john and the report to mike tomorrow",
      edited: "please call Priya about budget review on Friday",
      steps: { m: 0, c: 0, d: 11, i: 8 },
      rewrite: true,
      candidates: [],
    },
    {
      pasted: "um so like cloud code is great",
      edited: "Claude Code is great",
      steps: { m: 2, c: 1, d: 4, i: 1 },
      candidates: [{ term: "Claude Code", heard: "um so like cloud code" }],
    },
    {
      pasted: "open cloud code and run it",
      edited: "open Claude",
      steps: { m: 1, c: 0, d: 5, i: 1 },
      candidates: [{ term: "Claude", heard: "cloud code and run it" }],
    },
    {
      pasted: "これはkubanetesのせっていです",
      edited: "これはKubernetesのせっていです",
      steps: { m: 10, c: 0, d: 1, i: 1 },
      candidates: [{ term: "Kubernetes", heard: "kubanetes" }],
    },
  ];

  it.each(rows)("$pasted → $edited", (row) => {
    const result = extractCandidates(row.pasted, row.edited);
    expect(result.steps).toEqual(row.steps);
    expect(result.rewrite).toBe(row.rewrite ?? false);
    expect(result.candidates).toEqual(row.candidates);
  });

  it("drops a run with more than 4 edited tokens", () => {
    const result = extractCandidates(
      "send it to john tomorrow",
      "send it to the one and only Jon tomorrow",
    );
    expect(result.rewrite).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("rejects a long paste retyped shorter: less than half of the pasted tokens kept", () => {
    const pasted =
      "Hi all, here is where things stand after this week. The migration to the new staging cluster finished on Tuesday, and the pipeline that the cube flow team owns is now running on it without the memory issues we saw last month. I spent most of Wednesday with cloud code rewriting the ingestion job, and it cut the nightly run from forty minutes to about twelve.";
    const result = extractCandidates(
      pasted,
      "Quick heads-up on the vendor call: it moved to Thursday at three, and they want the revised scope document a day earlier than planned.",
    );
    expect(result.rewrite).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it("keeps a full rewrite of a short dictation (not more than 4 pairs)", () => {
    const result = extractCandidates("cube flow", "Kubeflow");
    expect(result.rewrite).toBe(false);
    expect(result.candidates).toEqual([
      { term: "Kubeflow", heard: "cube flow" },
    ]);
  });

  it("joins CJK tokens without spaces", () => {
    const result = extractCandidates("東京にいます", "大阪にいます");
    expect(result.candidates).toEqual([{ term: "大阪", heard: "東京" }]);
  });
});

describe("filterCandidates", () => {
  const none = new Set<string>();

  it("shape: needs a letter and no email or URL", () => {
    const result = filterCandidates(
      [
        candidate("2024"),
        candidate("jon@example.com"),
        candidate("https://example.com"),
        candidate("Jon"),
      ],
      none,
    );
    expect(result.kept).toEqual([candidate("Jon")]);
    expect(result.dropped.shape).toBe(3);
  });

  it("possessive: strips a trailing 's or ’s", () => {
    const result = filterCandidates(
      [candidate("Jon's", "johns"), candidate("Priya’s", "prias")],
      none,
    );
    expect(result.kept).toEqual([
      { term: "Jon", heard: "johns" },
      { term: "Priya", heard: "prias" },
    ]);
  });

  it("length: term 2–60 characters, heard at most 120", () => {
    const result = filterCandidates(
      [
        candidate("I"),
        candidate("a".repeat(61)),
        candidate("Fine", "h".repeat(121)),
        candidate("Ok", "h".repeat(120)),
      ],
      none,
    );
    expect(result.kept).toEqual([candidate("Ok", "h".repeat(120))]);
    expect(result.dropped.length).toBe(3);
  });

  it("known: drops a case-insensitive NFKC match, after the possessive strip", () => {
    const known = new Set(["github", "jon"]);
    const result = filterCandidates(
      [candidate("GitHub"), candidate("Jon's"), candidate("Kubeflow")],
      known,
    );
    expect(result.kept).toEqual([candidate("Kubeflow")]);
    expect(result.dropped.known).toBe(2);
  });

  it("cjk: drops Han, Hiragana and Katakana; keeps Hangul", () => {
    const result = filterCandidates(
      [
        candidate("東京"),
        candidate("せってい"),
        candidate("サーバー"),
        candidate("서울"),
      ],
      none,
    );
    expect(result.kept).toEqual([candidate("서울")]);
    expect(result.dropped.cjk).toBe(3);
  });

  it("cap: de-duplicates, prefers an uppercase letter or a digit, keeps 4", () => {
    const result = filterCandidates(
      [
        candidate("alpha"),
        candidate("beta"),
        candidate("Gamma"),
        candidate("gamma"),
        candidate("delta"),
        candidate("k8s"),
        candidate("Epsilon"),
      ],
      none,
    );
    expect(result.kept).toEqual([
      candidate("Gamma"),
      candidate("k8s"),
      candidate("Epsilon"),
      candidate("alpha"),
    ]);
    expect(result.dropped.duplicate).toBe(1); // gamma
    expect(result.dropped.cap).toBe(2); // beta, delta
  });

  it("reports zero drops when every candidate passes", () => {
    const result = filterCandidates([candidate("Kubeflow")], none);
    expect(result.dropped).toEqual({
      shape: 0,
      length: 0,
      known: 0,
      cjk: 0,
      duplicate: 0,
      cap: 0,
    });
  });
});

describe("normalizeVocabularyKey", () => {
  it("applies NFKC, lower case and trim", () => {
    expect(normalizeVocabularyKey("  ＧｉｔＨｕｂ ")).toBe("github");
    expect(normalizeVocabularyKey("Jon")).toBe("jon");
  });
});
