import { z } from 'zod';

export const ApiLocalizedErrorMessageSchema = z
  .object({
    locale: z.string(),
    message: z.string(),
  })
  .strip();

export type ApiLocalizedErrorMessage = z.output<typeof ApiLocalizedErrorMessageSchema>;

/** Shared error envelope for every HTTP API namespace. */
export const ApiErrorDetailsSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    localizedMessage: ApiLocalizedErrorMessageSchema.optional(),
    traceId: z.string().optional(),
    requestId: z.string().optional(),
  })
  .strip();

export type ApiErrorDetails = z.output<typeof ApiErrorDetailsSchema>;

export const ApiErrorResponseSchema = z
  .object({
    error: ApiErrorDetailsSchema,
  })
  .strip();

export type ApiErrorResponse = z.output<typeof ApiErrorResponseSchema>;
