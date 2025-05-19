import { z } from 'zod';

// No parameters needed for a simple pause toggle
export const MuteSystemAudioParamsSchema = z.object({}).optional();
export type MuteSystemAudioParams = z.infer<typeof MuteSystemAudioParamsSchema>;
