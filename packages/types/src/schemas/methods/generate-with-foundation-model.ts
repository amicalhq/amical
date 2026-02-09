import { z } from "zod";

// Request params
export const GenerateWithFoundationModelParamsSchema = z.object({
  systemPrompt: z.string(),
  userPrompt: z.string(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});
export type GenerateWithFoundationModelParams = z.infer<
  typeof GenerateWithFoundationModelParamsSchema
>;

// Response result
export const GenerateWithFoundationModelResultSchema = z.object({
  content: z.string(),
});
export type GenerateWithFoundationModelResult = z.infer<
  typeof GenerateWithFoundationModelResultSchema
>;
