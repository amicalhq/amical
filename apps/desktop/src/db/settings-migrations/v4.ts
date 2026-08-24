import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../utils/keycodes";
import { isMacOS } from "../../utils/platform";
import type { AppSettingsDataBeforeV6 } from "./legacy-shortcuts";

// v3 -> v4: Add default paste-last-transcript shortcut if missing
export function migrateToV4(data: unknown): AppSettingsDataBeforeV6 {
  const oldData = data as AppSettingsDataBeforeV6;
  const shortcuts = oldData.shortcuts ?? {};

  if (shortcuts.pasteLastTranscript !== undefined) {
    return oldData;
  }

  const defaultPasteShortcutKeycodes = isMacOS()
    ? [MAC_KEYCODES.CMD, MAC_KEYCODES.CTRL, MAC_KEYCODES.V]
    : [WINDOWS_KEYCODES.ALT, WINDOWS_KEYCODES.SHIFT, WINDOWS_KEYCODES.Z];

  return {
    ...oldData,
    shortcuts: {
      ...shortcuts,
      pasteLastTranscript: defaultPasteShortcutKeycodes,
    },
  };
}
