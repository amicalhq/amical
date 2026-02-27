import { describe, expect, it } from "vitest";
import { LANGUAGE_DEFAULT_PROMPTS, generateInitialPromptForLanguage, isTerminalApp } from "../../src/pipeline/providers/transcription/whisper-prompt-utils";

describe("generateInitialPromptForLanguage", () => {
  it("returns Japanese prompt with punctuation for ja language", () => {
    const result = generateInitialPromptForLanguage("ja");
    expect(result).toContain("。");
    expect(result).toContain("、");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns Chinese prompt for zh language", () => {
    const result = generateInitialPromptForLanguage("zh");
    expect(result).toContain("，");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns Korean prompt for ko language", () => {
    const result = generateInitialPromptForLanguage("ko");
    expect(result).toContain(".");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty string for en language", () => {
    const result = generateInitialPromptForLanguage("en");
    expect(result).toBe("");
  });

  it("returns empty string for auto language", () => {
    const result = generateInitialPromptForLanguage("auto");
    expect(result).toBe("");
  });

  it("returns empty string for undefined language", () => {
    const result = generateInitialPromptForLanguage(undefined);
    expect(result).toBe("");
  });
});

describe("isTerminalApp", () => {
  it("returns true for iTerm2", () => {
    expect(isTerminalApp("com.googlecode.iterm2")).toBe(true);
  });

  it("returns true for Terminal.app", () => {
    expect(isTerminalApp("com.apple.Terminal")).toBe(true);
  });

  it("returns true for Alacritty", () => {
    expect(isTerminalApp("io.alacritty")).toBe(true);
  });

  it("returns false for Safari", () => {
    expect(isTerminalApp("com.apple.Safari")).toBe(false);
  });

  it("returns false for VS Code", () => {
    expect(isTerminalApp("com.microsoft.VSCode")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTerminalApp(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTerminalApp("")).toBe(false);
  });
});
