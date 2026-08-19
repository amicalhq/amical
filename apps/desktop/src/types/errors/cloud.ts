import { Data } from "effect";
import type { DictationErrorCode } from "../error";

/**
 * Wire metadata shared by every cloud variant that derives from a transport
 * event. `wireCode` holds VALIDATED application codes only — the decode runs
 * `isDictationErrorCode` once and drops unrecognized server strings (routing
 * then keys on status). `serverUi` carries the server's display overrides
 * with their asymmetric gating: `title` may be present without `message`.
 */
export interface CloudMeta {
  wireCode?: DictationErrorCode;
  httpStatus?: number;
  grpcStatus?: number;
  traceId?: string;
  serverUi?: { title?: string; message?: string };
}

/** User- or lifecycle-initiated cancellation, incl. wire REQUEST_CANCELED. */
export class Cancelled extends Data.TaggedError("Cancelled")<{
  message: string;
  meta?: CloudMeta;
}> {}

/** Transport-level failure where a retry (or the HTTP fallback) may help. */
export class NetworkFailure extends Data.TaggedError("NetworkFailure")<{
  message: string;
  cause?: unknown;
  meta?: CloudMeta;
}> {}

/** The client-minted defense-in-depth idle close (gRPC CANCELLED on the wire). */
export class IdleTimeout extends Data.TaggedError("IdleTimeout")<{
  message: string;
  meta?: CloudMeta;
}> {}

/** Missing/invalid auth: local checks, wire AUTH_REQUIRED, or 401/403-class statuses. */
export class AuthRequired extends Data.TaggedError("AuthRequired")<{
  message: string;
  meta?: CloudMeta;
}> {}

/** Account-level throttle (wire RATE_LIMIT_EXCEEDED / HTTP 429). */
export class RateLimited extends Data.TaggedError("RateLimited")<{
  message: string;
  meta?: CloudMeta;
}> {}

/** Plan/word-limit cap (wire QUOTA_EXCEEDED / HTTP 402 / bare RESOURCE_EXHAUSTED). */
export class CloudQuotaExceeded extends Data.TaggedError("CloudQuotaExceeded")<{
  message: string;
  meta?: CloudMeta;
}> {}

/**
 * The server refused or failed the request: the remaining wire codes plus
 * status-only/undecodable failures in the server-error class. Projection
 * keys on the validated wireCode when present, else on status.
 */
export class ServerRejected extends Data.TaggedError("ServerRejected")<{
  message: string;
  meta: CloudMeta;
}> {}

/** The cloud engine was disposed while a session still raced it. */
export class CloudDisposed extends Data.TaggedError("CloudDisposed")<{
  message: string;
}> {}

export type CloudError =
  | Cancelled
  | NetworkFailure
  | IdleTimeout
  | AuthRequired
  | RateLimited
  | CloudQuotaExceeded
  | ServerRejected
  | CloudDisposed;

export const isCloudError = (error: unknown): error is CloudError =>
  error instanceof Cancelled ||
  error instanceof NetworkFailure ||
  error instanceof IdleTimeout ||
  error instanceof AuthRequired ||
  error instanceof RateLimited ||
  error instanceof CloudQuotaExceeded ||
  error instanceof ServerRejected ||
  error instanceof CloudDisposed;
