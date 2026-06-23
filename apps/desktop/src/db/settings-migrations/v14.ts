import type { AppSettingsData } from "../schema";
import { isMacOS } from "../../utils/platform";
import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../utils/keycodes";

// v13 -> v14: introduce the draft hotkey (UI: "Draft"; the wire preset stays
// "instruct"). This single migration folds the two concerns that ship as a
// unit:
//
//   1. Rename — early internal builds persisted the chord under
//      `shortcuts.instructMode`; carry it over to `shortcuts.draftMode` so the
//      user's binding survives the rename.
//   2. Backfill — otherwise seed the platform default so the feature works out
//      of the box: Fn+Ctrl on macOS, Ctrl+Win+Alt elsewhere. Both are
//      modifier-only (a non-modifier key would be swallowed by the subset
//      consume rule). Skipped when that chord is already bound to another
//      shortcut, so we never silently shadow an existing binding.
export function migrateToV14(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData & {
    shortcuts?: { instructMode?: number[] };
  };

  if (!oldData.shortcuts) {
    return oldData;
  }

  // 1. Legacy rename: instructMode -> draftMode (keep an existing draftMode).
  if (oldData.shortcuts.instructMode !== undefined) {
    const { instructMode, ...rest } = oldData.shortcuts;
    return {
      ...oldData,
      shortcuts: { ...rest, draftMode: rest.draftMode ?? instructMode },
    };
  }

  // Already bound -> leave unchanged.
  if (oldData.shortcuts.draftMode !== undefined) {
    return oldData;
  }

  // 2. Backfill the platform default unless that chord already maps elsewhere.
  const draftDefault = isMacOS()
    ? [MAC_KEYCODES.FN, MAC_KEYCODES.CTRL]
    : [WINDOWS_KEYCODES.CTRL, WINDOWS_KEYCODES.WIN, WINDOWS_KEYCODES.ALT];
  const isSameChord = (chord: number[] | undefined): boolean =>
    chord !== undefined &&
    chord.length === draftDefault.length &&
    [...chord].sort((a, b) => a - b).join(",") ===
      [...draftDefault].sort((a, b) => a - b).join(",");

  const { pushToTalk, toggleRecording, pasteLastTranscript, newNote } =
    oldData.shortcuts;
  const conflicts = [
    pushToTalk,
    toggleRecording,
    pasteLastTranscript,
    newNote,
  ].some(isSameChord);
  if (conflicts) {
    return oldData;
  }

  return {
    ...oldData,
    shortcuts: { ...oldData.shortcuts, draftMode: draftDefault },
  };
}
