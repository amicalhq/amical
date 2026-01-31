import type { AppSettingsData } from "../schema";

// Type for v1 settings (before shortcuts array migration)
interface AppSettingsDataV1 extends Omit<AppSettingsData, "shortcuts"> {
  shortcuts?: {
    pushToTalk?: string;
    toggleRecording?: string;
    toggleWindow?: string;
  };
}

// v1 -> v2: Convert shortcuts from string ("Fn+Space") to array (["Fn", "Space"])
export function migrateToV2(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsDataV1;
  const oldShortcuts = oldData.shortcuts;

  const convertShortcut = (
    shortcut: string | undefined,
  ): string[] | undefined => {
    if (!shortcut || shortcut === "") {
      return undefined;
    }
    return shortcut.split("+");
  };

  return {
    ...oldData,
    shortcuts: oldShortcuts
      ? {
          pushToTalk: convertShortcut(oldShortcuts.pushToTalk),
          toggleRecording: convertShortcut(oldShortcuts.toggleRecording),
        }
      : undefined,
  } as AppSettingsData;
}
