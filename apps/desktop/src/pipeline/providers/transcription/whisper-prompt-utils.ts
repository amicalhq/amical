/**
 * Language-specific default prompts for Whisper.
 * Whisper adapts its output style (punctuation, formatting) to match the initial_prompt.
 * These prompts contain proper punctuation to guide Whisper's output for CJK languages.
 */
export const LANGUAGE_DEFAULT_PROMPTS: Record<string, string> = {
  ja: "当店の自慢は、時間をかけて仕込んだビーフカレーです。",
  zh: "你好，今天天气不错。",
  ko: "안녕하세요. 오늘 날씨가 좋네요.",
};

/**
 * Returns a language-specific default prompt for Whisper.
 * Used as fallback when no prior transcription context is available.
 */
export function generateInitialPromptForLanguage(
  language: string | undefined,
): string {
  if (!language) return "";
  return LANGUAGE_DEFAULT_PROMPTS[language] ?? "";
}

/**
 * Known terminal app bundle identifiers.
 * Terminal apps return noisy preSelectionText (ANSI escapes, commands, etc.)
 * that is not useful as Whisper initial prompt.
 */
const TERMINAL_BUNDLE_IDS = [
  "com.googlecode.iterm2",
  "com.apple.Terminal",
  "io.alacritty",
  "net.kovidgoyal.kitty",
  "dev.warp.Warp-Stable",
  "com.github.wez.wezterm",
  "co.zeit.hyper",
];

/**
 * Returns true if the given bundleId belongs to a terminal application.
 */
export function isTerminalApp(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  return TERMINAL_BUNDLE_IDS.includes(bundleId);
}
