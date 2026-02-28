import { z } from "zod";

// Request params
export const StopRecordingParamsSchema = z.object({
  wasMuted: z.boolean(),
});
export type StopRecordingParams = z.infer<typeof StopRecordingParamsSchema>;

// Response result
export const StopRecordingResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type StopRecordingResult = z.infer<typeof StopRecordingResultSchema>;
