import { describe, expect, it } from "vitest";
import { countWords, toLocalStatsDate } from "@utils/dictation-stats";

describe("dictation stats utils", () => {
  it("counts zero words for empty or whitespace-only strings", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("counts words across repeated whitespace and newlines", () => {
    expect(countWords("hello")).toBe(1);
    expect(countWords("hello   world")).toBe(2);
    expect(countWords("hello\nworld\tagain")).toBe(3);
  });

  it("treats punctuation-adjacent tokens as words", () => {
    expect(countWords("hello, world!")).toBe(2);
  });

  it("counts non-whitespace languages with locale-aware segmentation", () => {
    expect(countWords("今日はいい天気です", "ja")).toBeGreaterThan(1);
    expect(countWords("今天天氣很好", "zh-TW")).toBeGreaterThan(1);
  });

  it("does not crash on invalid or non-standard locale hints", () => {
    expect(countWords("hello world", "english")).toBe(2);
    expect(countWords("hello world", "definitely-not-a-locale")).toBe(2);
  });

  it("formats local stats dates as YYYY-MM-DD", () => {
    expect(toLocalStatsDate(new Date(2026, 2, 29, 9, 15, 0))).toBe(
      "2026-03-29",
    );
  });
});
