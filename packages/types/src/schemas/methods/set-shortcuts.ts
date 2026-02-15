import { z } from "zod";

// Schema for setShortcuts RPC method
// Used to sync configured shortcuts to the native helper for event consumption

export const SetShortcutsParamsSchema = z.object({
  pushToTalk: z.array(z.number().int()),
  toggleRecording: z.array(z.number().int()),
  pasteLastTranscript: z.array(z.number().int()),
  newNote: z.array(z.number().int()),
});
export type SetShortcutsParams = z.infer<typeof SetShortcutsParamsSchema>;

export const SetShortcutsResultSchema = z.object({
  success: z.boolean(),
});
export type SetShortcutsResult = z.infer<typeof SetShortcutsResultSchema>;
