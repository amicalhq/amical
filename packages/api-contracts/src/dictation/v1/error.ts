import { z } from 'zod';
import {
  ApiErrorDetailsSchema,
  ApiErrorResponseSchema,
  ApiLocalizedErrorMessageSchema,
} from '../../error.js';

export const DictationErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'QUOTA_EXCEEDED',
  'RATE_LIMIT_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'AUDIO_BUFFER_EXCEEDED',
  'INVALID_REQUEST',
  'FAILED_PRECONDITION',
  'REQUEST_CANCELED',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'CONFLICT',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_SERVER_ERROR',
]);

export const DictationErrorCode = DictationErrorCodeSchema.enum;
export type DictationErrorCodeType = z.output<typeof DictationErrorCodeSchema>;

export const supportedDictationErrorLocales = ['en', 'de', 'es', 'ja', 'zh-TW'] as const;
export const DictationErrorLocaleSchema = z.enum(supportedDictationErrorLocales);
export type DictationErrorLocale = z.output<typeof DictationErrorLocaleSchema>;

export const DictationLocalizedErrorMessageSchema = ApiLocalizedErrorMessageSchema.extend({
  locale: DictationErrorLocaleSchema,
}).strip();

export type DictationLocalizedErrorMessage = z.output<
  typeof DictationLocalizedErrorMessageSchema
>;

export const DictationHttpErrorDetailsSchema = ApiErrorDetailsSchema.extend({
  code: DictationErrorCodeSchema,
  localizedMessage: DictationLocalizedErrorMessageSchema,
}).strip();

export type DictationHttpErrorDetails = z.output<typeof DictationHttpErrorDetailsSchema>;

export const DictationHttpErrorResponseSchema = ApiErrorResponseSchema.extend({
  error: DictationHttpErrorDetailsSchema,
}).strip();

export type DictationHttpErrorResponse = z.output<typeof DictationHttpErrorResponseSchema>;

/** Compatibility response for installed desktop clients at version 1.10.0 and below. */
export const DictationLegacyHttpErrorDetailsSchema = DictationHttpErrorDetailsSchema.omit({
  message: true,
}).extend({
  id: z.string().optional(),
}).strip();

export type DictationLegacyHttpErrorDetails = z.output<
  typeof DictationLegacyHttpErrorDetailsSchema
>;

export const DictationLegacyHttpErrorResponseSchema = ApiErrorResponseSchema.extend({
  error: DictationLegacyHttpErrorDetailsSchema,
}).strip();

export type DictationLegacyHttpErrorResponse = z.output<
  typeof DictationLegacyHttpErrorResponseSchema
>;

export const isDictationErrorCode = (value: unknown): value is DictationErrorCodeType =>
  DictationErrorCodeSchema.safeParse(value).success;
