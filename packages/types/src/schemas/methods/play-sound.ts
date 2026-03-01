import { z } from "zod";

// Request params
export const PlaySoundParamsSchema = z.object({
  sound: z.enum(["rec-start", "rec-stop"]),
});
export type PlaySoundParams = z.infer<typeof PlaySoundParamsSchema>;

// Response result
export const PlaySoundResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type PlaySoundResult = z.infer<typeof PlaySoundResultSchema>;
