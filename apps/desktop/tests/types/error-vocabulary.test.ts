import { describe, expect, it } from "vitest";
import {
  DictationErrorCodes,
  ErrorCodes,
  type DictationErrorCode,
  type ErrorCode,
} from "../../src/types/error";
import { WIRE_TO_UI } from "../../src/types/errors";
import { ERROR_CODE_CONFIG } from "../../src/types/widget-notification";

/**
 * Vocabulary pins: the code sets and the wire→UI mapping are consumed by the
 * renderer contract and analytics, so every row is frozen byte-for-byte.
 */

describe("error vocabulary pins", () => {
  it("the UI code set has exactly these 14 members", () => {
    expect(Object.values(ErrorCodes).sort()).toEqual(
      [
        "AUTH_REQUIRED",
        "IDLE_TIMEOUT",
        "INTERNAL_SERVER_ERROR",
        "LOCAL_TRANSCRIPTION_FAILED",
        "LOCAL_TRANSCRIPTION_UNSUPPORTED",
        "MICROPHONE_CAPTURE_FAILED",
        "MODEL_MISSING",
        "NETWORK_ERROR",
        "QUOTA_EXCEEDED",
        "RATE_LIMIT_EXCEEDED",
        "RETRY_IN_PROGRESS",
        "UNKNOWN",
        "WORKER_CRASHED",
        "WORKER_INITIALIZATION_FAILED",
      ].sort(),
    );
  });

  it("the wire code set has exactly these 14 members", () => {
    expect(Object.values(DictationErrorCodes).sort()).toEqual(
      [
        "AUTH_REQUIRED",
        "FORBIDDEN",
        "QUOTA_EXCEEDED",
        "RATE_LIMIT_EXCEEDED",
        "RESOURCE_EXHAUSTED",
        "AUDIO_BUFFER_EXCEEDED",
        "INVALID_REQUEST",
        "FAILED_PRECONDITION",
        "REQUEST_CANCELED",
        "DEADLINE_EXCEEDED",
        "NOT_FOUND",
        "CONFLICT",
        "SERVICE_UNAVAILABLE",
        "INTERNAL_SERVER_ERROR",
      ].sort(),
    );
  });

  it("maps every wire code to its UI code exactly as today", () => {
    const expected: Record<DictationErrorCode, ErrorCode> = {
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
    for (const code of Object.values(DictationErrorCodes)) {
      expect(WIRE_TO_UI[code]).toBe(expected[code]);
    }
  });

  it("the toast table has a config row for every UI code and no extras", () => {
    expect(Object.keys(ERROR_CODE_CONFIG).sort()).toEqual(
      Object.values(ErrorCodes).sort(),
    );
  });

  it("pins each code's toast title key", () => {
    const titleKeys = Object.fromEntries(
      Object.entries(ERROR_CODE_CONFIG).map(([code, config]) => [
        code,
        typeof config.title === "string" ? config.title : config.title.key,
      ]),
    );
    expect(titleKeys).toEqual({
      AUTH_REQUIRED: "widget.notifications.errorCode.authRequired.title",
      RATE_LIMIT_EXCEEDED:
        "widget.notifications.errorCode.rateLimitExceeded.title",
      QUOTA_EXCEEDED: "widget.notifications.errorCode.quotaExceeded.title",
      INTERNAL_SERVER_ERROR:
        "widget.notifications.errorCode.internalServerError.title",
      IDLE_TIMEOUT: "widget.notifications.errorCode.idleTimeout.title",
      UNKNOWN: "widget.notifications.errorCode.unknown.title",
      NETWORK_ERROR: "widget.notifications.errorCode.networkError.title",
      MODEL_MISSING: "widget.notifications.errorCode.modelMissing.title",
      RETRY_IN_PROGRESS: "widget.notifications.errorCode.retryInProgress.title",
      WORKER_INITIALIZATION_FAILED:
        "widget.notifications.errorCode.workerInitializationFailed.title",
      WORKER_CRASHED: "widget.notifications.errorCode.workerCrashed.title",
      LOCAL_TRANSCRIPTION_FAILED:
        "widget.notifications.errorCode.localTranscriptionFailed.title",
      LOCAL_TRANSCRIPTION_UNSUPPORTED:
        "widget.notifications.errorCode.localTranscriptionUnsupported.title",
      MICROPHONE_CAPTURE_FAILED: "widget.notifications.type.noAudio.title",
    });
  });
});
