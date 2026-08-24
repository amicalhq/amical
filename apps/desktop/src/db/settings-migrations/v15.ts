import type { AppSettingsData } from "../schema";
import type { AppSettingsDataBeforeV15 } from "./legacy-shortcuts";

// v14 -> v15: each action now stores a list of shortcut chords. Preserve each
// assigned chord as the first binding; absent and explicitly empty optional
// shortcuts remain unassigned.
export function migrateToV15(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsDataBeforeV15;
  if (!oldData.shortcuts) {
    return oldData as AppSettingsData;
  }

  const toBindings = (chord: number[] | undefined): number[][] | undefined =>
    chord?.length ? [chord] : undefined;

  return {
    ...oldData,
    shortcuts: {
      pushToTalk: toBindings(oldData.shortcuts.pushToTalk),
      toggleRecording: toBindings(oldData.shortcuts.toggleRecording),
      pasteLastTranscript: toBindings(oldData.shortcuts.pasteLastTranscript),
      newNote: toBindings(oldData.shortcuts.newNote),
      draftMode: toBindings(oldData.shortcuts.draftMode),
    },
  } as AppSettingsData;
}
