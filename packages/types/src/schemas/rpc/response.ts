import { z } from "zod";

export const RpcResponseSchema = z.object({
  id: z.string(),
  // method: z.string(), // The method is part of the request, not usually repeated in the response envelope
  result: z.any().optional(),
  error: z
    .object({
      code: z.number().int(),
      message: z.string(),
      data: z.any().optional(),
    }) // Changed code to int
    .optional(),
});
export type RpcResponse = z.infer<typeof RpcResponseSchema>;
