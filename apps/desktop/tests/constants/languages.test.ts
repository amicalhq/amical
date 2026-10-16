import { describe, it, expect } from "vitest";
import {
  dictationLanguageForLocale,
  oneCodePerLanguage,
} from "../../src/constants/languages";

describe("dictationLanguageForLocale", () => {
  it("maps plain language tags", () => {
    expect(dictationLanguageForLocale("fr")).toBe("fr");
    expect(dictationLanguageForLocale("hi")).toBe("hi");
  });

  it("maps region and script variants by primary subtag", () => {
    expect(dictationLanguageForLocale("en-US")).toBe("en");
    expect(dictationLanguageForLocale("pt-BR")).toBe("pt");
    expect(dictationLanguageForLocale("zh-Hant-TW")).toBe("zh");
  });

  it("is case-insensitive", () => {
    expect(dictationLanguageForLocale("DE-de")).toBe("de");
  });

  it("resolves OS aliases to whisper codes", () => {
    expect(dictationLanguageForLocale("nb-NO")).toBe("no");
    expect(dictationLanguageForLocale("fil-PH")).toBe("tl");
    expect(dictationLanguageForLocale("iw")).toBe("he");
  });

  it("returns undefined for languages whisper does not cover", () => {
    expect(dictationLanguageForLocale("tlh")).toBeUndefined(); // Klingon
    expect(dictationLanguageForLocale("eo")).toBeUndefined(); // Esperanto
  });

  it("never maps to the auto sentinel entry", () => {
    expect(dictationLanguageForLocale("auto")).toBeUndefined();
  });
});

describe("oneCodePerLanguage", () => {
  it("lets a later pick replace the plain language or another variant", () => {
    expect(oneCodePerLanguage(["en", "de", "en-GB"])).toEqual(["de", "en-GB"]);
    expect(oneCodePerLanguage(["en-GB", "en-CA"])).toEqual(["en-CA"]);
    expect(oneCodePerLanguage(["en-CA", "fr", "en"])).toEqual(["fr", "en"]);
  });

  it("treats Cantonese as independent of the Chinese options", () => {
    expect(oneCodePerLanguage(["zh", "yue"])).toEqual(["zh", "yue"]);
    expect(oneCodePerLanguage(["yue", "zh-Hans"])).toEqual(["yue", "zh-Hans"]);
  });
});
