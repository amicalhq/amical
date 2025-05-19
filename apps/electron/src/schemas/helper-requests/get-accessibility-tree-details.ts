import { z } from 'zod';

export const GetAccessibilityTreeDetailsParamsSchema = z.object({
  rootId: z.string().optional(), // Making rootId optional, maybe we want the whole tree
});
export type GetAccessibilityTreeDetailsParams = z.infer<
  typeof GetAccessibilityTreeDetailsParamsSchema
>;
