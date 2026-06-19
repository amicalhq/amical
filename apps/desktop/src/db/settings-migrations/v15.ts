import type { AppSettingsData } from "../schema";

// v14 -> v15: the instruct-mode hotkey was renamed to "draft" (UI: Draft; the
// wire preset stays "instruct"). Installs that ran the original v14 persisted
// the binding under `shortcuts.instructMode`; carry it over to
// `shortcuts.draftMode` so the user's chord survives the rename. Pre-v14
// installs were backfilled with `draftMode` directly by v14, so this is a no-op
// for them.
export function migrateToV15(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData & {
    shortcuts?: { instructMode?: number[] };
  };

  if (!oldData.shortcuts || oldData.shortcuts.instructMode === undefined) {
    return oldData;
  }

  const { instructMode, ...restShortcuts } = oldData.shortcuts;

  return {
    ...oldData,
    shortcuts: {
      ...restShortcuts,
      // Prefer an already-set draftMode; otherwise inherit the old binding.
      draftMode: restShortcuts.draftMode ?? instructMode,
    },
  };
}
