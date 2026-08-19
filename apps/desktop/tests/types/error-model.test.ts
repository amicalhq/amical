import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { status as GrpcStatus } from "@grpc/grpc-js";
import {
  AuthRequired,
  Cancelled,
  CloudDisposed,
  CloudQuotaExceeded,
  DependencyFailure,
  EngineDisposed,
  IdleTimeout,
  LocalTranscriptionFailed,
  LocalTranscriptionUnsupported,
  ModelMissing,
  NetworkFailure,
  RateLimited,
  ServerRejected,
  ServiceInitFailed,
  WIRE_TO_UI,
  WorkerCrashed,
  WorkerInitFailed,
  codeOf,
  failOrDie,
  settleExit,
  tagOf,
  toDependencyFailure,
  uiOf,
  type DictationError,
} from "../../src/types/errors";
import { DictationErrorCodes, ErrorCodes } from "../../src/types/error";

const msg = { message: "m" };

describe("error model projection", () => {
  it("projects every variant to its frozen code", () => {
    const rows: Array<[DictationError, string]> = [
      [new Cancelled(msg), ErrorCodes.NETWORK_ERROR],
      [new NetworkFailure(msg), ErrorCodes.NETWORK_ERROR],
      [new IdleTimeout(msg), ErrorCodes.IDLE_TIMEOUT],
      [new AuthRequired(msg), ErrorCodes.AUTH_REQUIRED],
      [new RateLimited(msg), ErrorCodes.RATE_LIMIT_EXCEEDED],
      [new CloudQuotaExceeded(msg), ErrorCodes.QUOTA_EXCEEDED],
      [new CloudDisposed(msg), ErrorCodes.UNKNOWN],
      [new ModelMissing(msg), ErrorCodes.MODEL_MISSING],
      [
        new WorkerInitFailed({ ...msg, cause: null }),
        ErrorCodes.WORKER_INITIALIZATION_FAILED,
      ],
      [new WorkerCrashed(msg), ErrorCodes.WORKER_CRASHED],
      [
        new LocalTranscriptionFailed({ ...msg, cause: null }),
        ErrorCodes.LOCAL_TRANSCRIPTION_FAILED,
      ],
      [
        new LocalTranscriptionUnsupported(msg),
        ErrorCodes.LOCAL_TRANSCRIPTION_UNSUPPORTED,
      ],
      [new EngineDisposed(msg), ErrorCodes.WORKER_INITIALIZATION_FAILED],
      [new DependencyFailure({ ...msg, cause: null }), ErrorCodes.UNKNOWN],
      [new ServiceInitFailed(msg), ErrorCodes.WORKER_INITIALIZATION_FAILED],
    ];
    for (const [variant, code] of rows) {
      expect(codeOf(variant)).toBe(code);
    }
  });

  it("projects ServerRejected by validated wire code through the re-homed rows", () => {
    for (const wireCode of Object.values(DictationErrorCodes)) {
      const variant = new ServerRejected({ ...msg, meta: { wireCode } });
      expect(codeOf(variant)).toBe(WIRE_TO_UI[wireCode]);
    }
  });

  it("projects wire-code-less ServerRejected by status", () => {
    const byStatus = (grpcStatus?: number, httpStatus?: number) =>
      codeOf(new ServerRejected({ ...msg, meta: { grpcStatus, httpStatus } }));
    expect(byStatus(undefined, 500)).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
    expect(byStatus(undefined, 502)).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
    expect(byStatus(GrpcStatus.INVALID_ARGUMENT)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    expect(byStatus(GrpcStatus.DEADLINE_EXCEEDED)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    expect(byStatus(GrpcStatus.ALREADY_EXISTS)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    expect(byStatus(GrpcStatus.FAILED_PRECONDITION)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    expect(byStatus(GrpcStatus.INTERNAL)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    // The invalid-code asymmetry: RESOURCE_EXHAUSTED only reaches
    // ServerRejected when the server sent an unrecognized code — server
    // error, never the quota upsell.
    expect(byStatus(GrpcStatus.RESOURCE_EXHAUSTED)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    expect(byStatus(GrpcStatus.NOT_FOUND)).toBe(ErrorCodes.UNKNOWN);
    // A present non-5xx httpStatus suppresses the grpc switch, as the
    // legacy ladder did.
    expect(byStatus(GrpcStatus.INTERNAL, 404)).toBe(ErrorCodes.UNKNOWN);
    // ...except RESOURCE_EXHAUSTED, whose legacy arm ran first: an invalid
    // application code with an embedded HTTP status stays a server error.
    expect(byStatus(GrpcStatus.RESOURCE_EXHAUSTED, 404)).toBe(
      ErrorCodes.INTERNAL_SERVER_ERROR,
    );
    // An extracted redirect status (captive portal / proxy 3xx) is
    // unclassified, exactly like the legacy final arms.
    expect(byStatus(GrpcStatus.INTERNAL, 302)).toBe(ErrorCodes.UNKNOWN);
    expect(byStatus(undefined, 302)).toBe(ErrorCodes.UNKNOWN);
    expect(byStatus(GrpcStatus.OK)).toBe(ErrorCodes.UNKNOWN);
    expect(byStatus()).toBe(ErrorCodes.UNKNOWN);
  });

  it("funnels foreign values to UNKNOWN with no tag", () => {
    expect(codeOf(new TypeError("bug"))).toBe(ErrorCodes.UNKNOWN);
    expect(codeOf("string")).toBe(ErrorCodes.UNKNOWN);
    expect(codeOf(null)).toBe(ErrorCodes.UNKNOWN);
    expect(tagOf(new TypeError("bug"))).toBeUndefined();
    expect(tagOf(new Cancelled(msg))).toBe("Cancelled");
  });

  it("uiOf reproduces the detail contract with its gating", () => {
    expect(
      uiOf(
        new ServerRejected({
          ...msg,
          meta: {
            serverUi: { title: "T", message: "M" },
            traceId: "trace-1",
          },
        }),
      ),
    ).toEqual({ uiTitle: "T", uiMessage: "M", traceId: "trace-1" });
    expect(
      uiOf(new ServerRejected({ ...msg, meta: { serverUi: { title: "T" } } })),
    ).toEqual({ uiTitle: "T", uiMessage: undefined, traceId: undefined });
    expect(
      uiOf(new NetworkFailure({ ...msg, meta: { traceId: "trace-2" } })),
    ).toEqual({ uiTitle: undefined, uiMessage: undefined, traceId: "trace-2" });
    expect(uiOf(new ServerRejected({ ...msg, meta: {} }))).toBeNull();
    expect(uiOf(new ModelMissing(msg))).toBeNull();
    expect(uiOf(new TypeError("bug"))).toBeNull();
  });
});

describe("lift helpers", () => {
  it("toDependencyFailure wraps foreign values and passes variants through", () => {
    const wrapped = toDependencyFailure(new Error("disk"));
    expect(wrapped).toBeInstanceOf(DependencyFailure);
    expect(wrapped.message).toBe("disk");
    const variant = new Cancelled(msg);
    expect(toDependencyFailure(variant)).toBe(variant);
  });

  it("failOrDie fails variants and dies on foreign values", async () => {
    const typed = await Effect.runPromiseExit(failOrDie(new Cancelled(msg)));
    expect(
      Exit.isFailure(typed) && Cause.failureOption(typed.cause)._tag === "Some",
    ).toBe(true);
    const foreign = await Effect.runPromiseExit(failOrDie(new TypeError("b")));
    expect(
      Exit.isFailure(foreign) &&
        Array.from(Cause.defects(foreign.cause))[0] instanceof TypeError,
    ).toBe(true);
  });
});

describe("settleExit", () => {
  it("returns success values", () => {
    expect(settleExit(Exit.succeed(7))).toBe(7);
  });

  it("rethrows the failure and hands every co-defect to onDropped", () => {
    const failure = new Cancelled(msg);
    const coDefect = new RangeError("finalizer bug");
    const exit = Exit.failCause(
      Cause.sequential(Cause.fail(failure), Cause.die(coDefect)),
    );
    const onDropped = vi.fn();
    expect(() => settleExit(exit, onDropped)).toThrow(failure);
    expect(onDropped).toHaveBeenCalledExactlyOnceWith([coDefect]);
  });

  it("rethrows the first defect and hands the rest to onDropped", () => {
    const first = new CloudQuotaExceeded(msg);
    const second = new RangeError("finalizer bug");
    const exit = Exit.failCause(
      Cause.sequential(Cause.die(first), Cause.die(second)),
    );
    const onDropped = vi.fn();
    expect(() => settleExit(exit, onDropped)).toThrow(first);
    expect(onDropped).toHaveBeenCalledExactlyOnceWith([second]);
  });

  it("does not call onDropped when nothing is dropped", () => {
    const onDropped = vi.fn();
    expect(() =>
      settleExit(Exit.failCause(Cause.fail(new Cancelled(msg))), onDropped),
    ).toThrow();
    expect(() =>
      settleExit(Exit.failCause(Cause.die(new TypeError("b"))), onDropped),
    ).toThrow();
    expect(onDropped).not.toHaveBeenCalled();
  });
});
