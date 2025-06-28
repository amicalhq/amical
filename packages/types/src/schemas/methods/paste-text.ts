import { z } from "zod";

// Request params
export const PasteTextParamsSchema = z.object({
  transcript: z.string(),
});
export type PasteTextParams = z.infer<typeof PasteTextParamsSchema>;

// Response result
export const PasteTextResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(), // Optional message for errors or status
});
export type PasteTextResult = z.infer<typeof PasteTextResultSchema>;
