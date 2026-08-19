/**
 * Structured error response from the cloud API
 * Shape: { error: { code, message, localizedMessage?, details?, traceId?, requestId?, ui? } }
 */
export interface CloudLocalizedMessage {
  locale: string;
  message: string;
}

export interface CloudErrorResponse {
  /** Legacy trace alias from dictation API responses. */
  id?: string;
  traceId?: string;
  requestId?: string;
  code?: string;
  /** English developer-readable fallback. */
  message?: string;
  /** Display-ready text in the locale identified by this object. */
  localizedMessage?: CloudLocalizedMessage;
  details?: Readonly<Record<string, unknown>>;
  ui?: { title?: string; message?: string };
}

/** Application-level error codes emitted by the Axis dictation service. */
export const DictationErrorCodes = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
  AUDIO_BUFFER_EXCEEDED: "AUDIO_BUFFER_EXCEEDED",
  INVALID_REQUEST: "INVALID_REQUEST",
  FAILED_PRECONDITION: "FAILED_PRECONDITION",
  REQUEST_CANCELED: "REQUEST_CANCELED",
  DEADLINE_EXCEEDED: "DEADLINE_EXCEEDED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

export type DictationErrorCode =
  (typeof DictationErrorCodes)[keyof typeof DictationErrorCodes];

export const isDictationErrorCode = (
  value: unknown,
): value is DictationErrorCode =>
  typeof value === "string" &&
  Object.values(DictationErrorCodes).includes(value as DictationErrorCode);

/**
 * Error code constants for type safety
 */
export const ErrorCodes = {
  // Cloud API errors
  AUTH_REQUIRED: "AUTH_REQUIRED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  IDLE_TIMEOUT: "IDLE_TIMEOUT",
  UNKNOWN: "UNKNOWN",

  // Network errors
  NETWORK_ERROR: "NETWORK_ERROR",

  // Whisper/local errors
  MODEL_MISSING: "MODEL_MISSING",
  WORKER_INITIALIZATION_FAILED: "WORKER_INITIALIZATION_FAILED",
  WORKER_CRASHED: "WORKER_CRASHED",
  LOCAL_TRANSCRIPTION_FAILED: "LOCAL_TRANSCRIPTION_FAILED",
  LOCAL_TRANSCRIPTION_UNSUPPORTED: "LOCAL_TRANSCRIPTION_UNSUPPORTED",

  // Renderer microphone or audio graph could not start.
  MICROPHONE_CAPTURE_FAILED: "MICROPHONE_CAPTURE_FAILED",

  // A History retry currently owns the shared transcription resources.
  RETRY_IN_PROGRESS: "RETRY_IN_PROGRESS",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
