import { z } from 'zod';

export const PasteTextParamsSchema = z.object({
  transcript: z.string(),
});

export type PasteTextParams = z.infer<typeof PasteTextParamsSchema>;
