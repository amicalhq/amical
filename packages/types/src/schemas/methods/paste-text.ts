import { z } from "zod";

// Request params
export const PasteTextParamsSchema = z.object({
  transcript: z.string(),
  preserveClipboard: z.boolean().optional(),
});
export type PasteTextParams = z.infer<typeof PasteTextParamsSchema>;

// Response result
export const PasteTextResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(), // Optional message for errors or status
  // Linux only: false when the helper could not put the transcript on the
  // clipboard. The desktop then writes it with Electron's clipboard.
  clipboardSet: z.boolean().optional(),
});
export type PasteTextResult = z.infer<typeof PasteTextResultSchema>;
