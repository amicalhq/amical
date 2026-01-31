import type { AppSettingsData } from "../schema";
import { getKeycodeFromKeyName } from "../../utils/keycode-map";

// v5 -> v6: Convert shortcuts from key names to keycodes
export function migrateToV6(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
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
      pushToTalk: convertShortcut(
        shortcuts.pushToTalk as Array<string | number> | undefined,
      ),
      toggleRecording: convertShortcut(
        shortcuts.toggleRecording as Array<string | number> | undefined,
      ),
      pasteLastTranscript: convertShortcut(
        shortcuts.pasteLastTranscript as Array<string | number> | undefined,
      ),
    },
  };
}
