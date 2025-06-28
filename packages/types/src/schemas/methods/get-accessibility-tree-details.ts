import { z } from "zod";

// Request params
export const GetAccessibilityTreeDetailsParamsSchema = z.object({
  rootId: z.string().optional(), // Making rootId optional, maybe we want the whole tree
});
export type GetAccessibilityTreeDetailsParams = z.infer<
  typeof GetAccessibilityTreeDetailsParamsSchema
>;

// Response result
export const GetAccessibilityTreeDetailsResultSchema = z.object({
  tree: z.any(), // Replace with your tree schema once defined
});
export type GetAccessibilityTreeDetailsResult = z.infer<
  typeof GetAccessibilityTreeDetailsResultSchema
>;
