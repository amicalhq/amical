import { getKeycodeFromKeyName } from "../../utils/keycode-map";
import type {
  AppSettingsDataBeforeV15,
  AppSettingsDataBeforeV6,
} from "./legacy-shortcuts";

// v5 -> v6: Convert shortcuts from key names to keycodes
export function migrateToV6(data: unknown): AppSettingsDataBeforeV15 {
  const oldData = data as AppSettingsDataBeforeV6;
  const shortcuts = oldData.shortcuts ?? {};

  const convertShortcut = (
    keys: Array<string | number> | undefined,
  ): number[] | undefined => {
    if (!keys) return undefined;
    if (keys.length === 0) return [];

    const converted: number[] = [];
    for (const key of keys) {
      if (typeof key === "number") {
        converted.push(key);
        continue;
      }
      const keycode = getKeycodeFromKeyName(key);
      if (keycode !== undefined) {
        converted.push(keycode);
      }
    }
    return converted;
  };

  return {
    ...oldData,
    shortcuts: {
      ...shortcuts,
      pushToTalk: convertShortcut(shortcuts.pushToTalk),
      toggleRecording: convertShortcut(shortcuts.toggleRecording),
      pasteLastTranscript: convertShortcut(shortcuts.pasteLastTranscript),
    },
  } as AppSettingsDataBeforeV15;
}
