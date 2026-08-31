import {
  CloudAppsV1ErrorCodeSchema,
  CloudHttpErrorResponseSchema,
  type CloudLocalizedErrorMessage,
} from "@amical/types";
import { Data } from "effect";

export interface CloudRequestMeta {
  wireCode?: string;
  rawCode?: string;
  httpStatus?: number;
  grpcStatus?: number;
  traceId?: string;
  requestId?: string;
  localizedMessage?: CloudLocalizedErrorMessage;
  retryAfter?: string;
  serverUi?: { title?: string; message?: string };
}

export class AuthenticationRequired extends Data.TaggedError(
  "AuthenticationRequired",
)<{
  message: string;
  meta?: CloudRequestMeta;
}> {}

export class AccessForbidden extends Data.TaggedError("AccessForbidden")<{
  message: string;
  meta: CloudRequestMeta;
}> {}

export class BadRequest extends Data.TaggedError("BadRequest")<{
  message: string;
  meta: CloudRequestMeta;
}> {}

export class RateLimited extends Data.TaggedError("RateLimited")<{
  message: string;
  meta?: CloudRequestMeta;
}> {}

export class CloudNetworkFailure extends Data.TaggedError(
  "CloudNetworkFailure",
)<{
  message: string;
  cause: unknown;
}> {}

export class CloudHttpFailure extends Data.TaggedError("CloudHttpFailure")<{
  message: string;
  meta: CloudRequestMeta;
  cause?: unknown;
}> {}

export type CloudRequestError =
  | AuthenticationRequired
  | AccessForbidden
  | BadRequest
  | RateLimited
  | CloudNetworkFailure
  | CloudHttpFailure;

export interface DecodeCloudHttpFailureInput {
  status: number;
  statusText?: string;
  body?: unknown;
  fallbackMessage?: string;
  retryAfter?: string;
  additionalMeta?: CloudRequestMeta;
}

export const decodeCloudHttpFailure = ({
  status,
  statusText,
  body,
  fallbackMessage,
  retryAfter,
  additionalMeta,
}: DecodeCloudHttpFailureInput): Exclude<
  CloudRequestError,
  CloudNetworkFailure
> => {
  const parsed = CloudHttpErrorResponseSchema.safeParse(body);
  const details = parsed.success ? parsed.data.error : undefined;
  const recognizedCode = details
    ? CloudAppsV1ErrorCodeSchema.safeParse(details.code)
    : undefined;
  const message =
    details?.message ??
    fallbackMessage ??
    `Cloud request failed with ${status}${statusText ? ` ${statusText}` : ""}`;
  const meta: CloudRequestMeta = {
    ...additionalMeta,
    wireCode:
      details !== undefined
        ? recognizedCode?.success
          ? recognizedCode.data
          : undefined
        : additionalMeta?.wireCode,
    rawCode:
      details !== undefined
        ? !recognizedCode?.success
          ? details.code
          : undefined
        : additionalMeta?.rawCode,
    httpStatus: status,
    traceId: details?.traceId ?? additionalMeta?.traceId,
    requestId: details?.requestId ?? additionalMeta?.requestId,
    localizedMessage:
      details?.localizedMessage ?? additionalMeta?.localizedMessage,
    retryAfter: retryAfter ?? additionalMeta?.retryAfter,
  };

  if (status === 400) {
    return new BadRequest({ message, meta });
  }

  switch (details?.code) {
    case "AUTH_REQUIRED":
      return new AuthenticationRequired({ message, meta });
    case "FORBIDDEN":
      return new AccessForbidden({ message, meta });
    case "RATE_LIMIT_EXCEEDED":
      return new RateLimited({ message, meta });
  }

  if (recognizedCode?.success) {
    return new CloudHttpFailure({ message, meta });
  }

  switch (status) {
    case 401:
      return new AuthenticationRequired({ message, meta });
    case 403:
      return new AccessForbidden({ message, meta });
    case 429:
      return new RateLimited({ message, meta });
    default:
      return new CloudHttpFailure({ message, meta });
  }
};
