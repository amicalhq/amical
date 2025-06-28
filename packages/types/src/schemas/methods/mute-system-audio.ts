import { z } from "zod";

// Request params
export const MuteSystemAudioParamsSchema = z.object({}).optional();
export type MuteSystemAudioParams = z.infer<typeof MuteSystemAudioParamsSchema>;

// Response result
export const MuteSystemAudioResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type MuteSystemAudioResult = z.infer<typeof MuteSystemAudioResultSchema>;
