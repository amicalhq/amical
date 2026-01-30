/**
 * Structured error response from the cloud API
 * Shape: { error: { id, code, message, ui?: { title } } }
 */
export interface CloudErrorResponse {
  id?: string;
  code?: string;
  message?: string;
  ui?: { title?: string; message?: string };
}

/**
 * Error code constants for type safety
 */
export const ErrorCodes = {
  // Cloud API errors
  AUTH_REQUIRED: "AUTH_REQUIRED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  UNKNOWN: "UNKNOWN",

  // Network errors
  NETWORK_ERROR: "NETWORK_ERROR",

  // Whisper/local errors
  MODEL_MISSING: "MODEL_MISSING",
  WORKER_INITIALIZATION_FAILED: "WORKER_INITIALIZATION_FAILED",
  WORKER_CRASHED: "WORKER_CRASHED",
  LOCAL_TRANSCRIPTION_FAILED: "LOCAL_TRANSCRIPTION_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Application error with error code for UI mapping.
 *
 * - `message`: Technical details for logging (not user-facing)
 * - `errorCode`: Used to look up user-facing strings from ERROR_CODE_CONFIG
 * - `uiTitle`/`uiMessage`: Optional overrides for user-facing display
 */
export class AppError extends Error {
  constructor(
    message: string,
    public errorCode: ErrorCode,
    public statusCode?: number,
    public uiTitle?: string,
    public uiMessage?: string,
    public traceId?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
