import { z } from "zod";

// Request params
export const RestoreSystemAudioParamsSchema = z.object({}).optional();
export type RestoreSystemAudioParams = z.infer<
  typeof RestoreSystemAudioParamsSchema
>;

// Response result
export const RestoreSystemAudioResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type RestoreSystemAudioResult = z.infer<
  typeof RestoreSystemAudioResultSchema
>;
