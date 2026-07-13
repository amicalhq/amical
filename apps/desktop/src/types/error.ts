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

  // Control signal, not a failure: the user dismissed the dictation.
  // finalizeSession throws this so the caller can silently abandon the session
  // (no failure/no-speech notification).
  USER_DISMISSED: "USER_DISMISSED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const DICTATION_ERROR_TO_UI_ERROR: Readonly<
  Record<DictationErrorCode, ErrorCode>
> = {
  [DictationErrorCodes.AUTH_REQUIRED]: ErrorCodes.AUTH_REQUIRED,
  [DictationErrorCodes.FORBIDDEN]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.QUOTA_EXCEEDED]: ErrorCodes.QUOTA_EXCEEDED,
  [DictationErrorCodes.RATE_LIMIT_EXCEEDED]: ErrorCodes.RATE_LIMIT_EXCEEDED,
  [DictationErrorCodes.RESOURCE_EXHAUSTED]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.AUDIO_BUFFER_EXCEEDED]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.INVALID_REQUEST]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.FAILED_PRECONDITION]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.REQUEST_CANCELED]: ErrorCodes.NETWORK_ERROR,
  [DictationErrorCodes.DEADLINE_EXCEEDED]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.NOT_FOUND]: ErrorCodes.UNKNOWN,
  [DictationErrorCodes.CONFLICT]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.SERVICE_UNAVAILABLE]: ErrorCodes.INTERNAL_SERVER_ERROR,
  [DictationErrorCodes.INTERNAL_SERVER_ERROR]: ErrorCodes.INTERNAL_SERVER_ERROR,
};

export const mapDictationErrorCodeToErrorCode = (
  code: DictationErrorCode,
): ErrorCode => DICTATION_ERROR_TO_UI_ERROR[code];

/**
 * Application error with error code for UI mapping.
 *
 * - `message`: Technical details for logging (not user-facing)
 * - `errorCode`: Used to look up user-facing strings from ERROR_CODE_CONFIG
 * - `uiTitle`/`uiMessage`: Optional overrides for user-facing display
 */
export interface AppErrorOptions {
  applicationCode?: DictationErrorCode;
  httpStatus?: number;
  grpcStatus?: number;
  uiTitle?: string;
  uiMessage?: string;
  traceId?: string;
}

export class AppError extends Error {
  public applicationCode?: DictationErrorCode;
  public httpStatus?: number;
  public grpcStatus?: number;
  public uiTitle?: string;
  public uiMessage?: string;
  public traceId?: string;

  constructor(
    message: string,
    public errorCode: ErrorCode,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = "AppError";
    this.applicationCode = options.applicationCode;
    this.httpStatus = options.httpStatus;
    this.grpcStatus = options.grpcStatus;
    this.uiTitle = options.uiTitle;
    this.uiMessage = options.uiMessage;
    this.traceId = options.traceId;
  }
}
