import { z } from "zod";

export const CloudLocalizedErrorMessageSchema = z
  .object({
    locale: z.string(),
    message: z.string(),
  })
  .strip();

export type CloudLocalizedErrorMessage = z.output<
  typeof CloudLocalizedErrorMessageSchema
>;

export const CloudHttpErrorDetailsSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    localizedMessage: CloudLocalizedErrorMessageSchema.optional(),
    traceId: z.string().optional(),
    requestId: z.string().optional(),
  })
  .strip();

export type CloudHttpErrorDetails = z.output<
  typeof CloudHttpErrorDetailsSchema
>;

export const CloudHttpErrorResponseSchema = z
  .object({
    error: CloudHttpErrorDetailsSchema,
  })
  .strip();

export type CloudHttpErrorResponse = z.output<
  typeof CloudHttpErrorResponseSchema
>;

export const CLOUD_APPS_V1_ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL_SERVER_ERROR",
  "INVALID_REQUEST",
  "RATE_LIMIT_EXCEEDED",
] as const;

export const CloudAppsV1ErrorCodeSchema = z.enum(CLOUD_APPS_V1_ERROR_CODES);

export type CloudAppsV1ErrorCode = z.output<typeof CloudAppsV1ErrorCodeSchema>;
