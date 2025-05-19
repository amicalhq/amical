// It's good practice to also define a result schema, even if it's simple

import { z } from 'zod';

// For paste, the result might just be a success boolean or empty if no specific data is returned.
export const PasteTextResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(), // Optional message for errors or status
});

export type PasteTextResult = z.infer<typeof PasteTextResultSchema>;
