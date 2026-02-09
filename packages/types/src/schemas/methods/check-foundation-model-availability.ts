import { z } from "zod";

// Request params
export const CheckFoundationModelAvailabilityParamsSchema = z
  .object({})
  .optional();
export type CheckFoundationModelAvailabilityParams = z.infer<
  typeof CheckFoundationModelAvailabilityParamsSchema
>;

// Response result
export const CheckFoundationModelAvailabilityResultSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
});
export type CheckFoundationModelAvailabilityResult = z.infer<
  typeof CheckFoundationModelAvailabilityResultSchema
>;
