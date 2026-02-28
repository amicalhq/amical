import { z } from "zod";

// Request params
export const StartRecordingParamsSchema = z.object({
  muteSystemAudio: z.boolean(),
});
export type StartRecordingParams = z.infer<typeof StartRecordingParamsSchema>;

// Response result
export const StartRecordingResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type StartRecordingResult = z.infer<typeof StartRecordingResultSchema>;
