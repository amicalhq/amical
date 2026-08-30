import { describe, expect, it } from "vitest";

import {
  AccessForbidden,
  AuthenticationRequired,
  CloudHttpFailure,
  RateLimited,
  decodeCloudHttpFailure,
} from "../../src/types/errors";

describe("cloud HTTP error decoding", () => {
  it.each([
    ["AUTH_REQUIRED", 403, AuthenticationRequired, "AuthenticationRequired"],
    ["FORBIDDEN", 401, AccessForbidden, "AccessForbidden"],
    ["RATE_LIMIT_EXCEEDED", 500, RateLimited, "RateLimited"],
  ] as const)(
    "gives validated %s precedence over HTTP %s",
    (code, status, ErrorType, tag) => {
      const error = decodeCloudHttpFailure({
        status,
        body: { error: { code, message: "Cloud message" } },
      });

      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({
        _tag: tag,
        message: "Cloud message",
        meta: { wireCode: code, httpStatus: status },
      });
    },
  );

  it("falls back to status for an unknown future code and retains it separately", () => {
    const error = decodeCloudHttpFailure({
      status: 403,
      body: { error: { code: "FUTURE_CODE", message: "Future failure" } },
    });

    expect(error).toBeInstanceOf(AccessForbidden);
    expect(error.meta).toMatchObject({
      httpStatus: 403,
      rawCode: "FUTURE_CODE",
      wireCode: undefined,
    });
  });

  it("preserves known unhandled codes and shared envelope metadata", () => {
    const error = decodeCloudHttpFailure({
      status: 404,
      retryAfter: "120",
      body: {
        error: {
          code: "NOT_FOUND",
          message: "Missing",
          localizedMessage: { locale: "de", message: "Fehlt" },
          traceId: "trace-1",
          requestId: "request-1",
        },
      },
    });

    expect(error).toBeInstanceOf(CloudHttpFailure);
    expect(error).toMatchObject({
      message: "Missing",
      meta: {
        wireCode: "NOT_FOUND",
        httpStatus: 404,
        traceId: "trace-1",
        requestId: "request-1",
        retryAfter: "120",
        localizedMessage: { locale: "de", message: "Fehlt" },
      },
    });
  });

  it("does not reinterpret a known unhandled code from a contradictory status", () => {
    const error = decodeCloudHttpFailure({
      status: 401,
      body: {
        error: { code: "INVALID_REQUEST", message: "Invalid request" },
      },
    });

    expect(error).toBeInstanceOf(CloudHttpFailure);
    expect(error).toMatchObject({
      meta: { wireCode: "INVALID_REQUEST", httpStatus: 401 },
    });
  });

  it("lets a decoded body override adapter metadata without losing retry metadata", () => {
    const error = decodeCloudHttpFailure({
      status: 401,
      body: {
        error: { code: "AUTH_REQUIRED", message: "Authentication required" },
      },
      additionalMeta: {
        wireCode: "FORBIDDEN",
        retryAfter: "60",
      },
    });

    expect(error).toMatchObject({
      _tag: "AuthenticationRequired",
      meta: { wireCode: "AUTH_REQUIRED", retryAfter: "60" },
    });
  });

  it("does not expose malformed response content and uses status fallback", () => {
    const error = decodeCloudHttpFailure({
      status: 401,
      body: "<html>proxy failure</html>",
      fallbackMessage: "Request failed",
    });

    expect(error).toEqual(
      new AuthenticationRequired({
        message: "Request failed",
        meta: {
          httpStatus: 401,
          retryAfter: undefined,
          wireCode: undefined,
          rawCode: undefined,
          traceId: undefined,
          requestId: undefined,
          localizedMessage: undefined,
        },
      }),
    );
  });
});
