import { z } from "zod";

// Schema for setShortcuts RPC method
// Used to sync configured shortcuts to the native helper for event consumption.
//
// The native helper is a consumption gate, not a semantic matcher: it only
// decides whether to swallow a key so it doesn't leak to the focused app (the
// "which shortcut fired" matching lives in the desktop ShortcutManager). So it
// needs the keys grouped by *match rule*, not by shortcut identity:
//   - subsetChords: matched "building toward" (activeKeys ⊆ chord + a chord
//     modifier held) — push-to-talk and draft.
//   - exactChords: matched only when exactly held — toggle/paste/new-note.
// Each entry is one chord (a list of key codes); a group is a list of chords.
export const SetShortcutsParamsSchema = z.object({
  subsetChords: z.array(z.array(z.number().int())),
  exactChords: z.array(z.array(z.number().int())),
});
export type SetShortcutsParams = z.infer<typeof SetShortcutsParamsSchema>;

export const SetShortcutsResultSchema = z.object({
  success: z.boolean(),
});
export type SetShortcutsResult = z.infer<typeof SetShortcutsResultSchema>;
