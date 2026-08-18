import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  _resetDictationTraceForTests,
  closeSessionTrace,
  expectObligation,
  flushAllDictationTraces,
  installDictationTrace,
  openSessionTrace,
  recordChunkAggregate,
  recordPoint,
} from "../../src/main/telemetry/dictation-trace";
import { runPromise } from "../../src/main/runtime/telemetry-runtime";

const flushed: Array<Record<string, unknown>> = [];

const install = () => {
  flushed.length = 0;
  installDictationTrace({
    trackDictationTrace: (properties) => {
      flushed.push(properties);
    },
  });
};

const span = (
  name: string,
  sessionId: string,
  inner: Effect.Effect<unknown, unknown> = Effect.void,
) =>
  runPromise(inner.pipe(Effect.withSpan(name, { attributes: { sessionId } })));

afterEach(() => {
  _resetDictationTraceForTests();
  vi.useRealTimers();
});

describe("dictation trace", () => {
  it("a session with zero expected obligations flushes immediately at close", () => {
    install();
    openSessionTrace("s1", { mode: "dictate", model_id: "whisper-local" });
    closeSessionTrace("s1", { disposition: "empty" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].disposition).toBe("empty");
    expect(flushed[0].mode).toBe("dictate");
    expect(flushed[0].flush_reason).toBe("settled");
    expect(typeof flushed[0].session_duration_ms).toBe("number");
  });

  it("flush waits for expected obligations, then fires exactly once", async () => {
    install();
    openSessionTrace("s2", {});
    expectObligation("s2", "storage.commit");
    closeSessionTrace("s2", { disposition: "delivered" });
    expect(flushed).toHaveLength(0);

    await span("storage.commit", "s2");
    expect(flushed).toHaveLength(1);
    expect(flushed[0].storage_duration_ms).toBeTypeOf("number");

    // Nothing after the flush produces a second event.
    await span("lifecycle.unmute-ambiance", "s2");
    closeSessionTrace("s2", { disposition: "delivered" });
    expect(flushed).toHaveLength(1);
  });

  it("the grace cap flushes an unsettled trace and late records are dropped", () => {
    vi.useFakeTimers();
    install();
    openSessionTrace("s3", {});
    expectObligation("s3", "lifecycle.recorder-close");
    closeSessionTrace("s3", { disposition: "dismissed" });
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(15_000);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].flush_reason).toBe("grace");

    recordPoint("s3", "late.point");
    recordChunkAggregate("s3", {
      modelId: null,
      provider: null,
      count: 1,
      vadMsSum: 0,
      vadMsMax: 0,
      transcribeMsSum: 0,
      transcribeMsMax: 0,
      materializeMs: 0,
      firstChunkAt: null,
      lastChunkAt: null,
    });
    expect(flushed).toHaveLength(1);
  });

  it("the terminal-latch point event wins failure attribution over a failing span", async () => {
    install();
    openSessionTrace("s4", {});
    recordPoint("s4", "transcription.terminal-latch", {
      stage: "transcription.chunks",
      errorCode: "WORKER_CRASHED",
    });
    await span(
      "transcription.resolve",
      "s4",
      Effect.fail(Object.assign(new Error("late"), { code: "UNKNOWN" })).pipe(
        Effect.ignore,
        Effect.zipRight(Effect.fail("resolve failed")),
      ),
    ).catch(() => undefined);
    closeSessionTrace("s4", { disposition: "failure" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].failed_stage).toBe("transcription.chunks");
    expect(flushed[0].error_code).toBe("WORKER_CRASHED");
  });

  it("a failing span provides attribution when no latch event exists", async () => {
    install();
    openSessionTrace("s5", {});
    await span(
      "resolve.flush",
      "s5",
      // AppError shape: the code lives on `errorCode` (production reality;
      // a `.code`-only fabrication masked a real extraction bug in review).
      Effect.fail(
        Object.assign(new Error("boom"), { errorCode: "NETWORK_ERROR" }),
      ),
    ).catch(() => undefined);
    closeSessionTrace("s5", { disposition: "failure" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].failed_stage).toBe("resolve.flush");
    expect(flushed[0].error_code).toBe("NETWORK_ERROR");
  });

  it("a dismissed session with a rejected in-flight span reports no stage failure", async () => {
    install();
    openSessionTrace("s8", {});
    await span(
      "resolve.flush",
      "s8",
      Effect.fail(
        Object.assign(new Error("aborted"), { errorCode: "CANCELLED" }),
      ),
    ).catch(() => undefined);
    closeSessionTrace("s8", { disposition: "dismiss" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].failed_stage).toBeUndefined();
    expect(flushed[0].error_code).toBeUndefined();
  });

  it("close args provide the error code for lifecycle-sealed failures", () => {
    install();
    openSessionTrace("s9", {});
    closeSessionTrace("s9", {
      disposition: "failure",
      errorCode: "MICROPHONE_PERMISSION_DENIED",
    });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].error_code).toBe("MICROPHONE_PERMISSION_DENIED");
  });

  it("shutdown force-flushes open traces with a shutdown disposition", () => {
    install();
    openSessionTrace("s10", {});
    expectObligation("s10", "storage.commit");
    flushAllDictationTraces();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].disposition).toBe("shutdown");
    // The entry is gone: nothing double-flushes later.
    closeSessionTrace("s10", { disposition: "failure" });
    expect(flushed).toHaveLength(1);
  });

  it("the chunk aggregate flattens once and is frozen after the first emit", () => {
    install();
    openSessionTrace("s6", {});
    recordChunkAggregate("s6", {
      modelId: "whisper-large",
      provider: "whisper-local",
      count: 42,
      vadMsSum: 100,
      vadMsMax: 9,
      transcribeMsSum: 900,
      transcribeMsMax: 80,
      materializeMs: 33,
      firstChunkAt: Date.now(),
      lastChunkAt: Date.now() + 10,
    });
    recordChunkAggregate("s6", {
      modelId: null,
      provider: null,
      count: 999,
      vadMsSum: 0,
      vadMsMax: 0,
      transcribeMsSum: 0,
      transcribeMsMax: 0,
      materializeMs: 0,
      firstChunkAt: null,
      lastChunkAt: null,
    });
    closeSessionTrace("s6", { disposition: "delivered" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].chunk_count).toBe(42);
    expect(flushed[0].model_id).toBe("whisper-large");
    expect(flushed[0].provider).toBe("whisper-local");
    expect(flushed[0].transcribe_duration_sum_ms).toBe(900);
    expect(flushed[0].first_chunk_offset_ms).toBeTypeOf("number");
  });

  it("lifecycle spans and the nested resolve tree both land in one payload", async () => {
    install();
    openSessionTrace("s7", {});
    await span("lifecycle.mute-ambiance", "s7");
    await runPromise(
      Effect.void.pipe(
        Effect.withSpan("resolve.drain", { attributes: { sessionId: "s7" } }),
        Effect.withSpan("transcription.resolve", {
          attributes: { sessionId: "s7" },
        }),
      ),
    );
    closeSessionTrace("s7", { disposition: "delivered" });
    expect(flushed).toHaveLength(1);
    // Both the lifecycle span and the resolve tree landed in the payload.
    expect(flushed[0].mute_duration_ms).toBeTypeOf("number");
    expect(flushed[0].resolve_duration_ms).toBeTypeOf("number");
    expect(flushed[0].resolve_drain_duration_ms).toBeTypeOf("number");
  });
});
