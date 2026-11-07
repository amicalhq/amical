import { status as GrpcStatus } from "@grpc/grpc-js";
import {
  isDictationErrorCode,
  DictationErrorCodes,
} from "../../../types/error";
import {
  AccessForbidden,
  AuthenticationRequired,
  Cancelled,
  CloudQuotaExceeded,
  NetworkFailure,
  RateLimited,
  ServerRejected,
  type CloudError,
  type CloudMeta,
} from "../../../types/errors";

export interface WireFailureInput {
  message: string;
  grpcStatus?: number;
  httpStatus?: number;
  traceId?: string;
  /** The server's application code as received — validated here, once. */
  rawWireCode?: string;
  localizedMessage?: string;
}

/**
 * The single owner of the validated-wire-code → variant rule, shared by
 * both transports' decodes.
 */
export const variantForWireCode = (
  wireCode: (typeof DictationErrorCodes)[keyof typeof DictationErrorCodes],
  message: string,
  meta: CloudMeta,
): CloudError => {
  switch (wireCode) {
    case DictationErrorCodes.AUTH_REQUIRED:
      return new AuthenticationRequired({ message, meta });
    case DictationErrorCodes.FORBIDDEN:
      return new AccessForbidden({ message, meta });
    case DictationErrorCodes.QUOTA_EXCEEDED:
      return new CloudQuotaExceeded({ message, meta });
    case DictationErrorCodes.RATE_LIMIT_EXCEEDED:
      return new RateLimited({ message, meta });
    case DictationErrorCodes.REQUEST_CANCELED:
      return new Cancelled({ message, meta });
    default:
      return new ServerRejected({ message, meta });
  }
};

/**
 * The ONE wire decode: classifies a transport failure into its cloud
 * variant. Selection branches on the RAW application code while it is still
 * in hand (the absent-vs-invalid RESOURCE_EXHAUSTED asymmetry depends on
 * it), then discards unrecognized codes — they never enter the projection
 * or the meta. The server's localized message rides only with a validated
 * code, matching the legacy gating.
 */
export const decodeWireFailure = (input: WireFailureInput): CloudError => {
  const { message, grpcStatus, httpStatus, traceId } = input;

  if (isDictationErrorCode(input.rawWireCode)) {
    return variantForWireCode(input.rawWireCode, message, {
      wireCode: input.rawWireCode,
      grpcStatus,
      httpStatus,
      traceId,
      serverUi: input.localizedMessage
        ? { message: input.localizedMessage }
        : undefined,
    });
  }

  const rawCodePresent = Boolean(input.rawWireCode);
  const meta: CloudMeta = { grpcStatus, httpStatus, traceId };

  switch (grpcStatus) {
    case GrpcStatus.UNAUTHENTICATED:
      return new AuthenticationRequired({ message, meta });
    case GrpcStatus.PERMISSION_DENIED:
      return new AccessForbidden({ message, meta });
    case GrpcStatus.RESOURCE_EXHAUSTED:
      // Absent code: the server's only bare RESOURCE_EXHAUSTED is the plan
      // cap. A present-but-unrecognized code means the server said
      // something newer than this client — a server error, not the upsell.
      return rawCodePresent
        ? new ServerRejected({ message, meta })
        : new CloudQuotaExceeded({ message, meta });
  }

  switch (httpStatus) {
    case 401:
      return new AuthenticationRequired({ message, meta });
    case 403:
      return new AccessForbidden({ message, meta });
    case 402:
      return new CloudQuotaExceeded({ message, meta });
    case 429:
      return new RateLimited({ message, meta });
  }

  if (httpStatus === undefined) {
    switch (grpcStatus) {
      case GrpcStatus.CANCELLED:
        return new Cancelled({ message, meta });
      case GrpcStatus.UNAVAILABLE:
        return new NetworkFailure({ message, meta });
    }
  }

  // Remaining statuses (5xx, INVALID_ARGUMENT-class, NOT_FOUND, none)
  // project through ServerRejected's status arm.
  return new ServerRejected({ message, meta });
};
