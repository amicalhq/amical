import { z } from 'zod';

export const MuteSystemAudioResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type MuteSystemAudioResult = z.infer<typeof MuteSystemAudioResultSchema>;
