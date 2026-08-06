import { v4 as uuid } from "uuid";
import { getAllSnippets } from "../../db/snippets";
import { getAllVocabulary } from "../../db/vocabulary";
import { selectVocabularyHints } from "../../utils/vocabulary-hints";
import type { SettingsService } from "../settings-service";
import type { DictationContext } from "./types";

export interface LoadDictationContextOptions {
  settingsService: Pick<SettingsService, "getDictationSettings">;
  sessionId?: string;
}

export async function loadDictationContext(
  options: LoadDictationContextOptions,
): Promise<DictationContext> {
  const dictationSettings =
    await options.settingsService.getDictationSettings();
  const configuredLanguages = dictationSettings.languages ?? [];
  const languages =
    dictationSettings.autoDetectEnabled || configuredLanguages.length === 0
      ? undefined
      : configuredLanguages;

  const replacements = new Map<string, string>();
  const vocabularyEntries = await getAllVocabulary();
  for (const entry of vocabularyEntries) {
    if (entry.replacementWord !== null) {
      replacements.set(entry.word, entry.replacementWord);
    }
  }

  const snippetEntries = await getAllSnippets();
  for (const snippet of snippetEntries) {
    replacements.set(snippet.trigger, snippet.content);
  }

  return {
    sessionId: options.sessionId ?? uuid(),
    vocabulary: selectVocabularyHints(vocabularyEntries),
    replacements,
    languages,
    formattingStyle: "formal",
    audio: {
      source: "microphone",
    },
    accessibilityContext: null,
    cloudFormattingEnabled: false,
    isInstruct: false,
  };
}
