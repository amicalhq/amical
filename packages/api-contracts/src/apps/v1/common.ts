import { z } from 'zod';
import { ApiErrorDetailsSchema, ApiErrorResponseSchema } from '../../error.js';

export const AppsV1IsoDateTimeSchema = z.iso.datetime();

export const AppsV1ErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL_SERVER_ERROR',
  'INVALID_REQUEST',
  'CONFLICT',
  'RATE_LIMIT_EXCEEDED',
]);
export type AppsV1ErrorCode = z.output<typeof AppsV1ErrorCodeSchema>;

export const AppsV1ErrorResponseSchema = ApiErrorResponseSchema.extend({
  error: ApiErrorDetailsSchema.extend({ code: AppsV1ErrorCodeSchema }).strip(),
}).strip();

export type AppsV1ErrorResponse = z.output<typeof AppsV1ErrorResponseSchema>;
