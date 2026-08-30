import { status as GrpcStatus } from "@grpc/grpc-js";
import { Match } from "effect";
import { ErrorCodes, type DictationErrorCode, type ErrorCode } from "../error";
import type { AccessForbidden } from "./cloud-request";
import type { ServerRejected } from "./cloud";
import { isCloudError } from "./cloud";
import { isDictationError, type DictationError } from "./union";

/**
 * The wire→UI rows, re-homed from the deleted legacy mapping table and
 * pinned row-by-row in tests.
 */
export const WIRE_TO_UI: Readonly<Record<DictationErrorCode, ErrorCode>> = {
  AUTH_REQUIRED: ErrorCodes.AUTH_REQUIRED,
  FORBIDDEN: ErrorCodes.INTERNAL_SERVER_ERROR,
  QUOTA_EXCEEDED: ErrorCodes.QUOTA_EXCEEDED,
  RATE_LIMIT_EXCEEDED: ErrorCodes.RATE_LIMIT_EXCEEDED,
  RESOURCE_EXHAUSTED: ErrorCodes.INTERNAL_SERVER_ERROR,
  AUDIO_BUFFER_EXCEEDED: ErrorCodes.INTERNAL_SERVER_ERROR,
  INVALID_REQUEST: ErrorCodes.INTERNAL_SERVER_ERROR,
  FAILED_PRECONDITION: ErrorCodes.INTERNAL_SERVER_ERROR,
  REQUEST_CANCELED: ErrorCodes.NETWORK_ERROR,
  DEADLINE_EXCEEDED: ErrorCodes.INTERNAL_SERVER_ERROR,
  NOT_FOUND: ErrorCodes.UNKNOWN,
  CONFLICT: ErrorCodes.INTERNAL_SERVER_ERROR,
  SERVICE_UNAVAILABLE: ErrorCodes.INTERNAL_SERVER_ERROR,
  INTERNAL_SERVER_ERROR: ErrorCodes.INTERNAL_SERVER_ERROR,
};

/**
 * Status arm for wire-code-less server rejections. The statuses that map to
 * first-class variants (auth/quota/rate/network classes) never reach here —
 * the decode selects those variants directly; what remains projects to the
 * server-error and unknown classes exactly as the legacy ladder did,
 * including the RESOURCE_EXHAUSTED-with-invalid-code asymmetry.
 */
const serverRejectedCode = (error: ServerRejected): ErrorCode => {
  const { wireCode, httpStatus, grpcStatus } = error.meta;
  if (wireCode) {
    return WIRE_TO_UI[wireCode];
  }
  // Legacy ladder order, preserved: the first gRPC switch ran BEFORE any
  // HTTP status was consulted — the only wire-code-less RESOURCE_EXHAUSTED
  // that reaches ServerRejected carried an invalid application code, and
  // it projected server-error regardless of an embedded HTTP status.
  if (grpcStatus === GrpcStatus.RESOURCE_EXHAUSTED) {
    return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
  // Then the HTTP arm suppresses the remaining gRPC switch: 5xx is a
  // server error; unclassified 3xx/4xx are unknown (as both legacy
  // ladders' final arms were); sub-300 exists only on the
  // undecodable-success mint, which keeps its server-error projection.
  if (httpStatus !== undefined) {
    if (httpStatus >= 500) {
      return ErrorCodes.INTERNAL_SERVER_ERROR;
    }
    if (httpStatus >= 300) {
      return ErrorCodes.UNKNOWN;
    }
    return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
  switch (grpcStatus) {
    case GrpcStatus.INVALID_ARGUMENT:
    case GrpcStatus.DEADLINE_EXCEEDED:
    case GrpcStatus.ALREADY_EXISTS:
    case GrpcStatus.FAILED_PRECONDITION:
    case GrpcStatus.INTERNAL:
      return ErrorCodes.INTERNAL_SERVER_ERROR;
    case GrpcStatus.NOT_FOUND:
      return ErrorCodes.UNKNOWN;
  }
  return ErrorCodes.UNKNOWN;
};

const accessForbiddenCode = (error: AccessForbidden): ErrorCode =>
  error.meta.wireCode === "FORBIDDEN"
    ? ErrorCodes.INTERNAL_SERVER_ERROR
    : ErrorCodes.AUTH_REQUIRED;

/**
 * The exhaustive projection: every variant to its frozen analytics/toast
 * code. Adding a variant without an arm here fails to compile — this is the
 * vocabulary gate.
 */
export const projectCode = (error: DictationError): ErrorCode =>
  Match.value(error).pipe(
    Match.tag("Cancelled", () => ErrorCodes.NETWORK_ERROR),
    Match.tag("NetworkFailure", () => ErrorCodes.NETWORK_ERROR),
    Match.tag("IdleTimeout", () => ErrorCodes.IDLE_TIMEOUT),
    Match.tag("AuthenticationRequired", () => ErrorCodes.AUTH_REQUIRED),
    Match.tag("AccessForbidden", accessForbiddenCode),
    Match.tag("RateLimited", () => ErrorCodes.RATE_LIMIT_EXCEEDED),
    Match.tag("CloudQuotaExceeded", () => ErrorCodes.QUOTA_EXCEEDED),
    Match.tag("ServerRejected", serverRejectedCode),
    Match.tag("CloudDisposed", () => ErrorCodes.UNKNOWN),
    Match.tag("ModelMissing", () => ErrorCodes.MODEL_MISSING),
    Match.tag(
      "WorkerInitFailed",
      () => ErrorCodes.WORKER_INITIALIZATION_FAILED,
    ),
    Match.tag("WorkerCrashed", () => ErrorCodes.WORKER_CRASHED),
    Match.tag(
      "LocalTranscriptionFailed",
      () => ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
    ),
    Match.tag(
      "LocalTranscriptionUnsupported",
      () => ErrorCodes.LOCAL_TRANSCRIPTION_UNSUPPORTED,
    ),
    Match.tag("EngineDisposed", () => ErrorCodes.WORKER_INITIALIZATION_FAILED),
    Match.tag("DependencyFailure", () => ErrorCodes.UNKNOWN),
    Match.tag(
      "ServiceInitFailed",
      () => ErrorCodes.WORKER_INITIALIZATION_FAILED,
    ),
    Match.exhaustive,
  );

/**
 * The funnel projection. MUST accept unknown: plain throws, defect rethrows,
 * and wrapped non-Errors all reach the consumer funnel and keep projecting
 * UNKNOWN exactly as before.
 */
export const codeOf = (error: unknown): ErrorCode =>
  isDictationError(error) ? projectCode(error) : ErrorCodes.UNKNOWN;

/** The variant tag for telemetry, or undefined for foreign values. */
export const tagOf = (error: unknown): string | undefined =>
  isDictationError(error) ? error._tag : undefined;

/** Rich-toast override channel: the frozen detail contract, null when empty. */
export interface FailureUi {
  uiTitle?: string;
  uiMessage?: string;
  traceId?: string;
}

export const uiOf = (error: unknown): FailureUi | null => {
  if (!isCloudError(error)) return null;
  const meta = "meta" in error ? error.meta : undefined;
  if (!meta) return null;
  const uiTitle = meta.serverUi?.title;
  const uiMessage = meta.serverUi?.message;
  const traceId = meta.traceId;
  if (!uiTitle && !uiMessage && !traceId) return null;
  return { uiTitle, uiMessage, traceId };
};
