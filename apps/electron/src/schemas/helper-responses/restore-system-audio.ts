import { z } from 'zod';

export const RestoreSystemAudioResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type RestoreSystemAudioResult = z.infer<typeof RestoreSystemAudioResultSchema>;
