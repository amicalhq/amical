import type { AppSettingsData } from "../schema";
import { isMacOS } from "../../utils/platform";
import { MAC_KEYCODES } from "../../utils/keycodes";

// v13 -> v14: introduce the instruct-mode hotkey. Existing installs have a
// `shortcuts` object without `instructMode`; backfill the macOS default
// (Fn+Ctrl) so the feature is usable out of the box. Only when the user has a
// shortcuts object and hasn't already bound it, and only on macOS (Windows is
// out of scope for instruct v1).
export function migrateToV14(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;

  if (!oldData.shortcuts) {
    return oldData;
  }
  if (oldData.shortcuts.instructMode !== undefined) {
    return oldData;
  }
  if (!isMacOS()) {
    return oldData;
  }

  return {
    ...oldData,
    shortcuts: {
      ...oldData.shortcuts,
      instructMode: [MAC_KEYCODES.FN, MAC_KEYCODES.CTRL],
    },
  };
}
