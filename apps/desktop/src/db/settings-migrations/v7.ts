import type { AppSettingsData } from "../schema";
import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../utils/keycodes";

// v6 -> v7: add default global shortcut for creating a new note
export function migrateToV7(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  const shortcuts = oldData.shortcuts ?? {};

  const defaultNewNoteShortcut =
    process.platform === "darwin"
      ? [MAC_KEYCODES.CMD, MAC_KEYCODES.CTRL, MAC_KEYCODES.N]
      : [WINDOWS_KEYCODES.ALT, WINDOWS_KEYCODES.SHIFT, WINDOWS_KEYCODES.N];

  return {
    ...oldData,
    shortcuts: {
      ...shortcuts,
      newNote: defaultNewNoteShortcut,
    },
  };
}
