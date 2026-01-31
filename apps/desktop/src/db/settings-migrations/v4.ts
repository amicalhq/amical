import type { AppSettingsData } from "../schema";
import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../utils/keycodes";
import { isMacOS } from "../../utils/platform";

// v3 -> v4: Add default paste-last-transcript shortcut if missing
export function migrateToV4(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
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
