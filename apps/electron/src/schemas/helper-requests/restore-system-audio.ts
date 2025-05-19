import { z } from 'zod';

// No parameters needed for a simple play toggle
export const RestoreSystemAudioParamsSchema = z.object({}).optional();
export type RestoreSystemAudioParams = z.infer<typeof RestoreSystemAudioParamsSchema>;
