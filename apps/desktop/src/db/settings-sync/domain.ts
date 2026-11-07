import type { SnippetSyncPayload, VocabularySyncPayload } from "../schema";

export function vocabularySyncPayload(row: {
  word: string;
  replacementWord: string | null;
}): VocabularySyncPayload {
  return { word: row.word, replacement: row.replacementWord };
}

export function snippetSyncPayload(row: {
  trigger: string;
  content: string;
}): SnippetSyncPayload {
  return { trigger: row.trigger, content: row.content };
}
