import { describe, it, expect } from "vitest";
import { applyTextReplacements } from "../../src/utils/text-replacement";

describe("applyTextReplacements", () => {
  describe("English (alphabetic languages)", () => {
    it("should replace English words with word boundaries", () => {
      const replacements = new Map([["apple", "りんご"]]);
      const result = applyTextReplacements("I like apple today", replacements);
      expect(result).toBe("I like りんご today");
    });

    it("should not replace partial matches in English", () => {
      const replacements = new Map([["apple", "りんご"]]);
      const result = applyTextReplacements(
        "I like pineapple today",
        replacements,
      );
      expect(result).toBe("I like pineapple today");
    });

    it("should replace multiple occurrences", () => {
      const replacements = new Map([["test", "テスト"]]);
      const result = applyTextReplacements(
        "test is a test for test",
        replacements,
      );
      expect(result).toBe("テスト is a テスト for テスト");
    });

    it("should be case-insensitive for English", () => {
      const replacements = new Map([["apple", "りんご"]]);
      const result = applyTextReplacements("I like APPLE today", replacements);
      expect(result).toBe("I like りんご today");
    });
  });

  describe("Japanese", () => {
    it("should replace Japanese words without word boundaries", () => {
      const replacements = new Map([["天気", "☀️"]]);
      const result = applyTextReplacements("今日は天気がいい", replacements);
      expect(result).toBe("今日は☀️がいい");
    });

    it("should replace hiragana words", () => {
      const replacements = new Map([["ありがとう", "🙏"]]);
      const result = applyTextReplacements(
        "ありがとうございます",
        replacements,
      );
      expect(result).toBe("🙏ございます");
    });

    it("should replace katakana words", () => {
      const replacements = new Map([["コーヒー", "☕"]]);
      const result = applyTextReplacements(
        "私はコーヒーが好きです",
        replacements,
      );
      expect(result).toBe("私は☕が好きです");
    });

    it("should replace multiple Japanese words", () => {
      const replacements = new Map([
        ["天気", "☀️"],
        ["今日", "📅"],
      ]);
      const result = applyTextReplacements("今日は天気がいい", replacements);
      expect(result).toBe("📅は☀️がいい");
    });
  });

  describe("Chinese", () => {
    it("should replace Chinese words", () => {
      const replacements = new Map([["你好", "👋"]]);
      const result = applyTextReplacements("你好世界", replacements);
      expect(result).toBe("👋世界");
    });
  });

  describe("Korean", () => {
    it("should replace Korean words", () => {
      const replacements = new Map([["안녕", "👋"]]);
      const result = applyTextReplacements("안녕하세요", replacements);
      expect(result).toBe("👋하세요");
    });
  });

  describe("Mixed language", () => {
    it("should handle mixed CJK and English replacements", () => {
      const replacements = new Map([
        ["天気", "weather"],
        ["good", "良い"],
      ]);
      const result = applyTextReplacements(
        "今日の天気は good です",
        replacements,
      );
      expect(result).toBe("今日のweatherは 良い です");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty text", () => {
      const replacements = new Map([["test", "テスト"]]);
      const result = applyTextReplacements("", replacements);
      expect(result).toBe("");
    });

    it("should handle empty replacements", () => {
      const replacements = new Map<string, string>();
      const result = applyTextReplacements("hello world", replacements);
      expect(result).toBe("hello world");
    });

    it("should handle special regex characters in words", () => {
      const replacements = new Map([["C++", "シープラプラ"]]);
      const result = applyTextReplacements(
        "I program in C++ language",
        replacements,
      );
      expect(result).toBe("I program in シープラプラ language");
    });

    it("should handle replacement to empty string", () => {
      const replacements = new Map([["削除", ""]]);
      const result = applyTextReplacements("これを削除します", replacements);
      expect(result).toBe("これをします");
    });

    it("should handle word at start of text", () => {
      const replacements = new Map([["Hello", "こんにちは"]]);
      const result = applyTextReplacements("Hello world", replacements);
      expect(result).toBe("こんにちは world");
    });

    it("should handle word at end of text", () => {
      const replacements = new Map([["world", "世界"]]);
      const result = applyTextReplacements("Hello world", replacements);
      expect(result).toBe("Hello 世界");
    });
  });
});
