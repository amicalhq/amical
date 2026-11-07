import { describe, expect, it } from "vitest";
import { buildWhisperPrompt } from "../../src/pipeline/providers/transcription/whisper-prompt";

describe("buildWhisperPrompt language conditioning", () => {
  it("omits target-app text when exactly one language is forced", () => {
    expect(
      buildWhisperPrompt({
        languages: ["ru"],
        beforeText: "ctrl esc to focus or unfocus Claude",
      }),
    ).toBeUndefined();
  });

  it("keeps vocabulary and previous transcription for a forced language", () => {
    expect(
      buildWhisperPrompt({
        languages: ["ru"],
        vocabulary: ["Amical", "Whisper"],
        previousTranscription: "предыдущая русская фраза",
        beforeText: "Write a message in English",
      }),
    ).toBe("Amical, Whisper. предыдущая русская фраза");
  });

  it.each([
    ["auto-detection", undefined],
    ["an empty language list", []],
    ["constrained multi-language detection", ["en", "ru"]],
  ])("keeps target-app text for %s", (_label, languages) => {
    expect(
      buildWhisperPrompt({
        languages,
        beforeText: "Write a message in English",
      }),
    ).toBe("Write a message in English");
  });
});
