import { expect } from "vitest";
import { codeOf, isDictationError } from "../../src/types/errors";

/**
 * The ONE pin surface for error characterization tests.
 *
 * Pins assert on this projection, never on the error class shape directly.
 * When the error model changes, the conversion step retargets THIS helper in
 * the same commit; the pins' expected values stay untouched. During the
 * conversion window it accepts both the tagged variants and the legacy
 * AppError shape (the legacy arm leaves with the deletion sweep).
 */
export interface ErrorProjection {
  code: string;
  tag?: string;
  wireCode?: string;
  grpcStatus?: number;
  httpStatus?: number;
  uiTitle?: string;
  uiMessage?: string;
  traceId?: string;
  message: string;
}

export const projectionOf = (error: unknown): ErrorProjection => {
  if (isDictationError(error)) {
    const meta = "meta" in error ? error.meta : undefined;
    return {
      code: codeOf(error),
      tag: error._tag,
      wireCode: meta?.wireCode,
      grpcStatus: meta?.grpcStatus,
      httpStatus: meta?.httpStatus,
      uiTitle: meta?.serverUi?.title,
      uiMessage: meta?.serverUi?.message,
      traceId: meta?.traceId,
      message: error.message,
    };
  }
  throw new Error(`projectionOf: expected an app error, got ${String(error)}`);
};

/** Await a rejection and return the rejected value. */
export const rejectionOf = async (
  promise: Promise<unknown>,
): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected the promise to reject");
    },
    (error: unknown) => error,
  );

/** Assert a rejection's projection, the .rejects.toMatchObject of this suite. */
export const expectRejectionProjection = async (
  promise: Promise<unknown>,
  expected: Partial<ErrorProjection>,
): Promise<void> => {
  expect(projectionOf(await rejectionOf(promise))).toMatchObject(expected);
};
