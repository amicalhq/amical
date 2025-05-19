import { z } from 'zod';

export const GetAccessibilityTreeDetailsResultSchema = z.object({
  tree: z.any(), // Replace with your tree schema once defined
});
export type GetAccessibilityTreeDetailsResult = z.infer<
  typeof GetAccessibilityTreeDetailsResultSchema
>;
