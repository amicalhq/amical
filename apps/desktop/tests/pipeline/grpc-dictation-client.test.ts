import { beforeEach, describe, expect, it, vi } from "vitest";

const grpcMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeMetadata {
    private readonly values = new Map<string, unknown[]>();

    set(key: string, value: unknown): void {
      this.values.set(key, [value]);
    }

    get(key: string): unknown[] {
      return this.values.get(key) ?? [];
    }
  }

  class FakeStream {
    private readonly handlers = new Map<string, Set<Handler>>();
    destroyed = false;
    writableEnded = false;
    write = vi.fn(
      (_message: Buffer, callback?: (error?: Error | null) => void) => {
        callback?.();
        return true;
      },
    );
    end = vi.fn(() => {
      this.writableEnded = true;
    });
    cancel = vi.fn(() => {
      this.destroyed = true;
      this.emit("close");
    });

    on(event: string, handler: Handler): this {
      const eventHandlers = this.handlers.get(event) ?? new Set<Handler>();
      eventHandlers.add(handler);
      this.handlers.set(event, eventHandlers);
      return this;
    }

    once(event: string, handler: Handler): this {
      const wrapped: Handler = (...args) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }

    off(event: string, handler: Handler): this {
      this.handlers.get(event)?.delete(handler);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const eventHandlers = [...(this.handlers.get(event) ?? [])];
      for (const handler of eventHandlers) {
        handler(...args);
      }
      return eventHandlers.length > 0;
    }
  }

  let lastStream: FakeStream | null = null;
  let lastClient: FakeClient | null = null;
  let lastClientArgs: {
    target: string;
    credentials: unknown;
    options: unknown;
  } | null = null;

  class FakeClient {
    close = vi.fn();

    constructor(target: string, credentials: unknown, options: unknown) {
      lastClient = this;
      lastClientArgs = { target, credentials, options };
    }

    makeBidiStreamRequest = vi.fn((..._args: unknown[]) => {
      lastStream = new FakeStream();
      return lastStream;
    });
  }

  const status = {
    OK: 0,
    CANCELLED: 1,
    UNKNOWN: 2,
    INTERNAL: 13,
    UNAVAILABLE: 14,
    UNAUTHENTICATED: 16,
  };

  return {
    module: {
      ChannelCredentials: {
        createSsl: vi.fn(() => ({ secure: true })),
        createInsecure: vi.fn(() => ({ secure: false })),
      },
      Client: FakeClient,
      Metadata: FakeMetadata,
      status,
    },
    metadata: () => new FakeMetadata(),
    status,
    getLastClient: () => lastClient,
    getLastClientArgs: () => lastClientArgs,
    getLastStream: () => lastStream,
    reset: () => {
      lastStream = null;
      lastClient = null;
      lastClientArgs = null;
    },
  };
});

vi.mock("@grpc/grpc-js", () => grpcMock.module);

import {
  buildLanguageConfig,
  CloudDictationGrpcStream,
  GrpcDictationError,
  type GrpcDictationStreamOptions,
} from "../../src/pipeline/providers/transcription/grpc-dictation-client";

const flushEffects = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createStream = (overrides: Partial<GrpcDictationStreamOptions> = {}) =>
  new CloudDictationGrpcStream({
    endpoint: "https://dictation.test",
    token: "token",
    userAgent: "test-agent",
    clientInfo: {
      client: "desktop",
      version: "0.0.0-test",
      platform: "darwin",
    },
    sessionId: "session-1",
    vocabulary: [],
    formatting: false,
    ...overrides,
  });

describe("buildLanguageConfig", () => {
  it("returns auto when the list is empty", () => {
    expect(buildLanguageConfig([])).toEqual({ auto: {} });
    expect(buildLanguageConfig(undefined)).toEqual({ auto: {} });
  });

  it("maps multiple language codes to enum items in order", () => {
    const result = buildLanguageConfig(["en", "es"]) as {
      languages: { items: number[] };
    };
    expect(result.languages.items).toEqual([1, 3]);
  });

  it("drops codes that have no enum mapping", () => {
    const result = buildLanguageConfig(["en", "zz-not-real"]) as {
      languages: { items: number[] };
    };
    expect(result.languages.items).toEqual([1]);
  });
});

describe("CloudDictationGrpcStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grpcMock.reset();
  });

  it("ignores late errors after a successful final transcript", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;
    const grpcClient = grpcMock.getLastClient()!;

    grpcStream.emit("data", {
      final: {
        rawTranscript: "raw",
        formattedTranscript: "formatted",
        throughSeq: "2",
      },
    });
    grpcStream.emit("status", {
      code: grpcMock.status.OK,
      details: "OK",
      metadata: grpcMock.metadata(),
    });

    await expect(clientStream.finalTranscript).resolves.toEqual({
      rawTranscript: "raw",
      formattedTranscript: "formatted",
      throughSeq: 2n,
    });

    grpcStream.emit("error", new Error("late transport error"));
    await flushEffects();

    expect(grpcStream.cancel).not.toHaveBeenCalled();
    expect(grpcClient.close).toHaveBeenCalledTimes(1);
  });

  it("preserves port 80 for default plaintext endpoints", () => {
    createStream({ endpoint: "http://dictation.test" });

    expect(grpcMock.getLastClientArgs()).toMatchObject({
      target: "dictation.test:80",
      credentials: { secure: false },
    });
  });

  it("preserves explicit non-default plaintext ports", () => {
    createStream({ endpoint: "http://dictation.test:4317" });

    expect(grpcMock.getLastClientArgs()).toMatchObject({
      target: "dictation.test:4317",
      credentials: { secure: false },
    });
  });

  it("configures aggressive gRPC keepalive options", () => {
    createStream();

    expect(grpcMock.getLastClientArgs()?.options).toMatchObject({
      "grpc.keepalive_time_ms": 5000,
      "grpc.keepalive_timeout_ms": 3000,
      "grpc.keepalive_permit_without_calls": 1,
      "grpc.http2.max_pings_without_data": 0,
      "grpc.http2.min_time_between_pings_ms": 5000,
      "grpc.http2.min_ping_interval_without_data_ms": 5000,
    });
  });

  it("sends explicit Amical client metadata", () => {
    const clientStream = createStream({
      clientInfo: {
        client: "desktop",
        version: "1.2.3",
        platform: "darwin",
      },
    });
    const client = grpcMock.getLastClient()!;
    const metadata = client.makeBidiStreamRequest.mock.calls[0]?.[3] as {
      get(key: string): unknown[];
    };

    expect(metadata.get("authorization")).toEqual(["Bearer token"]);
    expect(metadata.get("amical-client")).toEqual(["desktop"]);
    expect(metadata.get("amical-version")).toEqual(["1.2.3"]);
    expect(metadata.get("amical-platform")).toEqual(["darwin"]);
    expect(metadata.get("x-platform")).toEqual([]);

    clientStream.cancel();
  });

  it("resolves when OK status arrives before the final transcript", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;

    grpcStream.emit("status", {
      code: grpcMock.status.OK,
      details: "OK",
      metadata: grpcMock.metadata(),
    });
    grpcStream.emit("data", {
      final: {
        rawTranscript: "raw",
        formattedTranscript: "formatted",
        throughSeq: "3",
      },
    });

    await expect(clientStream.finalTranscript).resolves.toEqual({
      rawTranscript: "raw",
      formattedTranscript: "formatted",
      throughSeq: 3n,
    });
  });

  it("waits briefly for status when close arrives first", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;

    grpcStream.emit("data", {
      final: {
        rawTranscript: "raw",
        formattedTranscript: "formatted",
        throughSeq: "4",
      },
    });
    grpcStream.emit("close");
    await wait(20);
    grpcStream.emit("status", {
      code: grpcMock.status.OK,
      details: "OK",
      metadata: grpcMock.metadata(),
    });

    await expect(clientStream.finalTranscript).resolves.toEqual({
      rawTranscript: "raw",
      formattedTranscript: "formatted",
      throughSeq: 4n,
    });
  });

  it("rejects when the server returns OK without a final transcript", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;

    grpcStream.emit("end");
    grpcStream.emit("status", {
      code: grpcMock.status.OK,
      details: "OK",
      metadata: grpcMock.metadata(),
    });

    await expect(clientStream.finalTranscript).rejects.toMatchObject({
      name: "GrpcDictationError",
      message: "gRPC stream closed before final transcript",
      grpcStatus: grpcMock.status.OK,
    });
  });

  it("uses trace ID metadata on terminal errors", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;
    const metadata = grpcMock.metadata();
    metadata.set("x-trace-id", "trace-1");

    grpcStream.emit("metadata", metadata);
    grpcStream.emit("status", {
      code: grpcMock.status.UNAVAILABLE,
      details: "Received HTTP status code 503",
      metadata: grpcMock.metadata(),
    });

    await expect(clientStream.finalTranscript).rejects.toMatchObject({
      name: "GrpcDictationError",
      httpStatus: 503,
      traceId: "trace-1",
    });
  });

  it("preserves raw HTTP status from grpc-js synthesized status details", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;

    grpcStream.emit("status", {
      code: grpcMock.status.UNAVAILABLE,
      details: "Received HTTP status code 503",
      metadata: grpcMock.metadata(),
    });

    await expect(clientStream.finalTranscript).rejects.toMatchObject({
      name: "GrpcDictationError",
      grpcStatus: grpcMock.status.UNAVAILABLE,
      httpStatus: 503,
    });
    await expect(clientStream.finalTranscript).rejects.toBeInstanceOf(
      GrpcDictationError,
    );
  });

  it("preserves raw HTTP status from grpc-js ServiceError details", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;
    const metadata = grpcMock.metadata();
    metadata.set("x-trace-id", "trace-service-error");
    const serviceError = Object.assign(
      new Error("Received HTTP status code 429"),
      {
        code: grpcMock.status.UNAVAILABLE,
        details: "Received HTTP status code 429",
        metadata,
      },
    );

    grpcStream.emit("error", serviceError);

    await expect(clientStream.finalTranscript).rejects.toMatchObject({
      name: "GrpcDictationError",
      grpcStatus: grpcMock.status.UNAVAILABLE,
      httpStatus: 429,
      traceId: "trace-service-error",
    });
  });

  it("cancel writes a cancel frame, waits for the write callback, and rejects", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;
    let cancelWriteCallback: ((error?: Error | null) => void) | undefined;

    grpcStream.write.mockImplementationOnce(
      (_message: Buffer, callback?: (error?: Error | null) => void) => {
        cancelWriteCallback = callback;
        return true;
      },
    );

    clientStream.cancel();

    await expect(clientStream.finalTranscript).rejects.toMatchObject({
      name: "GrpcDictationError",
      message: "gRPC stream cancelled",
      grpcStatus: grpcMock.status.CANCELLED,
    });
    await flushEffects();

    expect(grpcStream.write).toHaveBeenCalledTimes(2);
    expect(grpcStream.end).not.toHaveBeenCalled();

    cancelWriteCallback?.();
    await flushEffects();

    expect(grpcStream.end).toHaveBeenCalledTimes(1);
  });

  it("cancel after final transcript settlement is a no-op", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;

    grpcStream.emit("data", {
      final: {
        rawTranscript: "raw",
        formattedTranscript: "formatted",
        throughSeq: "5",
      },
    });
    grpcStream.emit("status", {
      code: grpcMock.status.OK,
      details: "OK",
      metadata: grpcMock.metadata(),
    });

    await expect(clientStream.finalTranscript).resolves.toEqual({
      rawTranscript: "raw",
      formattedTranscript: "formatted",
      throughSeq: 5n,
    });

    clientStream.cancel();
    await flushEffects();

    expect(grpcStream.write).toHaveBeenCalledTimes(1);
    expect(grpcStream.cancel).not.toHaveBeenCalled();
  });

  it("rejects sendAudioBatch after cancel with the terminal error", async () => {
    const clientStream = createStream();

    clientStream.cancel();

    await expect(clientStream.finalTranscript).rejects.toMatchObject({
      name: "GrpcDictationError",
      message: "gRPC stream cancelled",
    });
    await expect(
      clientStream.sendAudioBatch(1n, [new Uint8Array([1, 2])]),
    ).rejects.toMatchObject({
      name: "GrpcDictationError",
      message: "gRPC stream cancelled",
    });
  });

  it("idle timer fires after IDLE_TIMEOUT_MS without sendAudioBatch and rejects with isIdleTimeout", async () => {
    vi.useFakeTimers();
    try {
      const clientStream = createStream();
      // Advance past the 10s idle window. unref()'d timers still fire under
      // fake timers when explicitly advanced.
      await vi.advanceTimersByTimeAsync(10_000);
      // Drain any background effects scheduled by the timer's failEffect,
      // then restore real timers so flushEffects()'s setImmediate fires.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      await flushEffects();

      await expect(clientStream.finalTranscript).rejects.toMatchObject({
        name: "GrpcDictationError",
        grpcStatus: grpcMock.status.CANCELLED,
        isIdleTimeout: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("idle timer is reset by sendAudioBatch and does not fire while audio is flowing", async () => {
    vi.useFakeTimers();
    try {
      const clientStream = createStream();

      // Send a packet at t=5s (within idle window) → resets the timer.
      await vi.advanceTimersByTimeAsync(5_000);
      void clientStream.sendAudioBatch(1n, [new Uint8Array([1, 2])]);
      // Advance another 5s (10s total, but only 5s since last send).
      await vi.advanceTimersByTimeAsync(5_000);
      // No timer should have fired yet — settle the stream cleanly so the
      // assertion below distinguishes "no idle fire" from "still pending."
      const stream = grpcMock.getLastStream()!;
      stream.emit("data", {
        final: {
          rawTranscript: "ok",
          formattedTranscript: "ok",
          throughSeq: "1",
        },
      });
      stream.emit("status", {
        code: grpcMock.status.OK,
        details: "OK",
        metadata: grpcMock.metadata(),
      });
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      await expect(clientStream.finalTranscript).resolves.toMatchObject({
        rawTranscript: "ok",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("finalize() is idempotent — second call returns the cached transcript", async () => {
    const clientStream = createStream();
    const grpcStream = grpcMock.getLastStream()!;

    grpcStream.emit("data", {
      final: {
        rawTranscript: "raw",
        formattedTranscript: "formatted",
        throughSeq: "7",
      },
    });
    grpcStream.emit("status", {
      code: grpcMock.status.OK,
      details: "OK",
      metadata: grpcMock.metadata(),
    });

    const writeCallsBefore = grpcStream.write.mock.calls.length;

    const first = await clientStream.finalize();
    const second = await clientStream.finalize();

    expect(first).toEqual({
      rawTranscript: "raw",
      formattedTranscript: "formatted",
      throughSeq: 7n,
    });
    expect(second).toEqual(first);
    // First finalize() writes the finalize frame; the second must NOT write again.
    expect(grpcStream.write.mock.calls.length).toBe(writeCallsBefore + 1);
    expect(grpcStream.end).toHaveBeenCalledTimes(1);
  });
});
