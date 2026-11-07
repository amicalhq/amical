import { describe, expect, it } from "vitest";

import {
  measureEdits,
  type EditMetrics,
} from "../../../src/services/vocabulary-learning/edit-metrics";

const filler = "lorem ipsum ".repeat(250).trim();

describe("measureEdits", () => {
  it.each<[string, string, string, Partial<EditMetrics>]>([
    [
      "line endings, BOM and an attachment placeholder are not edits",
      "Meet me at the cafe.\r\nSee you.",
      "\uFEFFMeet me at the cafe.\nSee you. \uFFFC",
      { change_kind: "none", char_edit_count: 0, matched_word_count: 7 },
    ],
    [
      "smart quotes and apostrophes from the host are not edits",
      'I don\'t say "hi".',
      "I don’t say “hi”.",
      { change_kind: "none", char_edit_count: 0 },
    ],
    [
      "full-width letters and digits from an input method are not edits",
      "Meeting at 3",
      "Ｍｅｅｔｉｎｇ at ３",
      { change_kind: "none", char_edit_count: 0 },
    ],
    [
      "full-width punctuation is not folded",
      "你好！",
      "你好!",
      {
        change_kind: "spacing_or_punctuation",
        char_edit_count: 1,
        matched_word_count: 2,
        punctuation_changed_word_count: 0,
      },
    ],
    [
      "punctuation fixes",
      "I went home I ate dinner",
      "I went home. I ate dinner.",
      {
        change_kind: "spacing_or_punctuation",
        matched_word_count: 6,
        punctuation_changed_word_count: 2,
        char_edit_count: 2,
      },
    ],
    [
      "a case fix",
      "hello there",
      "Hello there",
      { change_kind: "case", case_only_word_count: 1, matched_word_count: 1 },
    ],
    [
      "a misheard word next to a case fix",
      "open cloud code and run it",
      "open Claude Code and run it",
      {
        change_kind: "corrected",
        matched_word_count: 4,
        case_only_word_count: 1,
        substituted_word_count: 1,
        correction_run_count: 1,
        char_edit_count: 4,
      },
    ],
    [
      "a dropped word restored inside the text",
      "I will at the office.",
      "I will be at the office.",
      { change_kind: "corrected", inserted_word_count: 1, correction_run_count: 1 },
    ],
    [
      "filler words removed in two places",
      "So um I think uh we should go.",
      "So I think we should go.",
      { change_kind: "corrected", deleted_word_count: 2, correction_run_count: 2 },
    ],
    [
      "a continuation that moves the final period",
      "Meet me on Tuesday.",
      "Meet me on Tuesday, or Wednesday if needed.",
      {
        change_kind: "added",
        appended_word_count: 4,
        punctuation_changed_word_count: 0,
        correction_run_count: 0,
      },
    ],
    [
      "a prepend that lowers the first dictated word",
      "Sounds good, see you then.",
      "Yes, sounds good, see you then.",
      {
        change_kind: "added",
        prepended_word_count: 1,
        case_only_word_count: 0,
        matched_word_count: 5,
      },
    ],
    [
      "a fix at the end followed by more text",
      "See you on Friday.",
      "See you on Monday at noon.",
      {
        change_kind: "corrected",
        substituted_word_count: 1,
        appended_word_count: 2,
        correction_run_count: 1,
      },
    ],
    [
      "a full replacement keeps no word",
      "Send it now",
      "Please hold off",
      {
        change_kind: "corrected",
        substituted_word_count: 3,
        prepended_word_count: 0,
        appended_word_count: 0,
      },
    ],
    [
      "Chinese counts per character",
      "我今天去了商店",
      "我今天去了超市",
      {
        pasted_word_count: 7,
        substituted_word_count: 2,
        matched_word_count: 5,
        correction_run_count: 1,
        char_edit_count: 2,
      },
    ],
    [
      "edits far apart in a long text cap the distance, not the word counts",
      `Start ${filler} end.`,
      `Begin ${filler} finish.`,
      {
        char_edit_count_capped: true,
        substituted_word_count: 2,
        correction_run_count: 2,
        matched_word_count: 500,
      },
    ],
  ])("%s", (_name, pasted, final, expected) => {
    const metrics = measureEdits(pasted, final);

    expect(metrics).toMatchObject(expected);
    expect(
      metrics.matched_word_count +
        metrics.case_only_word_count +
        metrics.substituted_word_count +
        metrics.deleted_word_count,
    ).toBe(metrics.pasted_word_count);
    expect(
      metrics.matched_word_count +
        metrics.case_only_word_count +
        metrics.substituted_word_count +
        metrics.inserted_word_count +
        metrics.prepended_word_count +
        metrics.appended_word_count,
    ).toBe(metrics.final_word_count);
  });
});
