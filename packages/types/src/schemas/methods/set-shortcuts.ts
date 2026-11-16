import { z } from "zod";

// Schema for setShortcuts RPC method
// Used to sync configured shortcuts to the native helper for event consumption.
//
// The native helper is a consumption gate, not a semantic matcher: it only
// decides whether to swallow a key so it doesn't leak to the focused app (the
// "which shortcut fired" matching lives in the desktop ShortcutManager). A key
// is consumed only when a chord is *exactly* held — i.e. the regular key being
// pressed is the final key completing the chord — so a partially-held chord
// (e.g. Shift+D while PTT is Shift+Ctrl+D) never swallows the base key. Both
// groups are matched identically today; the split is retained only as the
// desktop's grouping (see TODO):
//   - subsetChords: push-to-talk and draft.
//   - exactChords: toggle/paste/new-note.
// Each entry is one chord (a list of key codes); a group is a list of chords.
//
// TODO(AMIC-19): subsetChords and exactChords are now matched identically by the
// native consume gate — collapse them into one `chords` array. That touches this
// schema, the generated Swift/C# models, both RpcHandlers, and the desktop
// syncShortcutsToNative; left split for now to keep the AMIC-19 fix surgical.
// Linux only: one descriptor per configured shortcut. A per-key backend
// consumes the chord keys from keyCodes. A chord backend binds each
// descriptor with the compositor and reports edges by id. The macOS and
// Windows helpers ignore this field.
export const ShortcutDescriptorSchema = z.object({
  /** `${type}:${index}`, e.g. "pushToTalk:0". Stable across versions: compositors store consent per id. */
  id: z.string(),
  /** evdev key codes. */
  keyCodes: z.array(z.number().int()),
  /** Localized text that the compositor shows, e.g. "Amical: Push to talk". */
  label: z.string(),
  /** hold: push-to-talk and draft. tap: toggle, paste last, new note. */
  kind: z.enum(["hold", "tap"]),
});
export type ShortcutDescriptor = z.infer<typeof ShortcutDescriptorSchema>;

export const SetShortcutsParamsSchema = z.object({
  subsetChords: z.array(z.array(z.number().int())),
  exactChords: z.array(z.array(z.number().int())),
  shortcuts: z.array(ShortcutDescriptorSchema).optional(),
});
export type SetShortcutsParams = z.infer<typeof SetShortcutsParamsSchema>;

export const SetShortcutsResultSchema = z.object({
  success: z.boolean(),
});
export type SetShortcutsResult = z.infer<typeof SetShortcutsResultSchema>;
