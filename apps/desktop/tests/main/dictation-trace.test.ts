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
  recordDefect,
  recordPhase,
  tracePhase,
  recordCapturePhases,
  recordAudioContextTelemetry,
  settleObligation,
} from "../../src/main/telemetry/dictation-trace";
import { runPromise } from "../../src/main/runtime/telemetry-runtime";
import { NetworkFailure } from "../../src/types/errors";
import type { AudioContextTelemetry } from "../../src/types/capture-timings";

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
  vi.restoreAllMocks();
});

describe("dictation trace", () => {
  const recovered: AudioContextTelemetry = {
    recoveryAttemptCount: 1,
    recoverySuccessCount: 1,
    recoveryFailureCount: 0,
    recoveryDurationMs: 125.125,
  };

  it("emits the latest cumulative recovery summary once without changing success", () => {
    install();
    openSessionTrace("recovered", {});
    expectObligation("recovered", "capture.timings");
    recordAudioContextTelemetry("recovered", {
      ...recovered,
      recoverySuccessCount: 0,
      recoveryDurationMs: 0,
    });
    recordAudioContextTelemetry("recovered", recovered);
    closeSessionTrace("recovered", { disposition: "success" });
    expect(flushed).toHaveLength(0);
    recordAudioContextTelemetry("recovered", recovered);
    settleObligation("recovered", "capture.timings");
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({
      disposition: "success",
      audio_context_recovery_attempt_count: 1,
      audio_context_recovery_success_count: 1,
      audio_context_recovery_failure_count: 0,
      audio_context_recovery_duration_ms: 125.125,
      trace_spans: [],
      trace_points: [],
    });
    expect(flushed[0]).not.toHaveProperty("failed_stage");
    expect(flushed[0]).not.toHaveProperty("error_code");
    expect(flushed[0]).not.toHaveProperty("audio_context_failure_operation");
    expect(flushed[0]).not.toHaveProperty("audio_context_failure_state");
  });

  it("preserves context failure details alongside the existing terminal cause", () => {
    install();
    openSessionTrace("context-failure", {});
    recordAudioContextTelemetry("context-failure", {
      ...recovered,
      recoveryAttemptCount: 2,
      recoveryFailureCount: 1,
      recoveryDurationMs: 210.5,
      failureOperation: "recover",
      failureState: "suspended",
    });
    closeSessionTrace("context-failure", {
      disposition: "failure",
      failedStage: "capture",
      errorCode: "MICROPHONE_CAPTURE_FAILED",
    });
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({
      disposition: "failure",
      failed_stage: "capture",
      error_code: "MICROPHONE_CAPTURE_FAILED",
      audio_context_recovery_attempt_count: 2,
      audio_context_recovery_success_count: 1,
      audio_context_recovery_failure_count: 1,
      audio_context_recovery_duration_ms: 210.5,
      audio_context_failure_operation: "recover",
      audio_context_failure_state: "suspended",
    });
  });

  it("omits context properties for clean sessions and drops reports after flush", () => {
    install();
    openSessionTrace("clean", {});
    closeSessionTrace("clean", { disposition: "success" });
    recordAudioContextTelemetry("clean", recovered);
    settleObligation("clean", "capture.timings");
    expect(flushed).toHaveLength(1);
    expect(
      Object.keys(flushed[0]).filter((key) => key.startsWith("audio_context_")),
    ).toEqual([]);
  });

  it("reports the latest observed capture format on the v2 event without leaking arbitrary fields", () => {
    install();
    openSessionTrace("channels", {});
    for (let frame = 0; frame < 1_000; frame++) {
      recordPoint("channels", "lifecycle.audio-capture", {
        inputChannelCount: 2,
        trackChannelCount: 2,
        stereoDownmixEnabled: true,
      });
    }
    recordPoint("channels", "lifecycle.audio-capture", {
      inputChannelCount: 1,
      trackChannelCount: 2,
      stereoDownmixEnabled: true,
      deviceId: "not-an-event-property",
    });
    closeSessionTrace("channels", { disposition: "empty" });
    expect(flushed[0]).toMatchObject({
      audio_input_channel_count: 1,
      audio_track_channel_count: 2,
      audio_stereo_downmix_enabled: true,
    });
    expect(flushed[0]).not.toHaveProperty("deviceId");
    expect(flushed[0].trace_points).toEqual([]);
  });

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
        Effect.andThen(Effect.fail("resolve failed")),
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
      // A domain variant projects its frozen code and carries its tag; a
      // foreign value would project UNKNOWN (the `.code` passthrough is
      // superseded — decided carve-out).
      Effect.fail(new NetworkFailure({ message: "boom" })),
    ).catch(() => undefined);
    closeSessionTrace("s5", { disposition: "failure" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].failed_stage).toBe("resolve.flush");
    expect(flushed[0].error_code).toBe("NETWORK_ERROR");
    expect(flushed[0].error_tag).toBe("NetworkFailure");
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

  it("stamps defect: true additively, keeping the disposition's code", () => {
    install();
    openSessionTrace("s-defect", { mode: "dictate" });
    recordDefect("s-defect");
    closeSessionTrace("s-defect", {
      disposition: "failure",
      failedStage: "transcription.stream",
      errorCode: "QUOTA_EXCEEDED",
    });
    const payload = flushed.at(-1)!;
    expect(payload.defect).toBe(true);
    expect(payload.error_code).toBe("QUOTA_EXCEEDED");
  });

  it("omits the defect flag when none occurred", () => {
    install();
    openSessionTrace("s-clean", { mode: "dictate" });
    closeSessionTrace("s-clean", { disposition: "empty" });
    expect(flushed.at(-1)!).not.toHaveProperty("defect");
  });
});

describe("v2 waterfall timing contract", () => {
  it("uses shared epoch timestamps for main and renderer offsets", () => {
    install();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    openSessionTrace("clock", {});
    recordPhase("clock", "transcription.provider-warmup", 980, 995);
    recordPhase("clock", "resolve.flush", 1010, 1040);
    recordCapturePhases("clock", [
      {
        name: "capture.get-user-media",
        startedAtMs: 1020,
        durationMs: 35,
      },
    ]);
    now.mockReturnValue(1100);
    recordPoint("clock", "lifecycle.recording-live");
    closeSessionTrace("clock", { disposition: "success" });
    expect(flushed[0]).toMatchObject({
      session_duration_ms: 100,
      provider_warmup_duration_ms: 15,
      provider_warmup_start_offset_ms: -20,
      resolve_flush_duration_ms: 30,
      resolve_flush_start_offset_ms: 10,
      capture_get_user_media_duration_ms: 35,
      capture_get_user_media_start_offset_ms: 20,
      recording_live_offset_ms: 100,
    });
    expect(flushed[0].trace_spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "capture.get-user-media",
          start_offset_ms: 20,
          duration_ms: 35,
          process: "renderer",
        }),
      ]),
    );
  });

  it("imports the whole capture batch before reporting completion can flush it", () => {
    install();
    vi.spyOn(Date, "now").mockReturnValue(100);
    openSessionTrace("capture", {});
    expectObligation("capture", "capture.timings");
    closeSessionTrace("capture", { disposition: "success" });
    recordCapturePhases("capture", [
      {
        name: "capture.get-user-media",
        startedAtMs: 210,
        durationMs: 30,
      },
      {
        name: "capture.first-frame-wait",
        startedAtMs: 160,
        durationMs: 25,
      },
    ]);
    expect(flushed).toHaveLength(0);
    settleObligation("capture", "capture.timings");
    expect(flushed[0].trace_spans).toEqual([
      expect.objectContaining({
        name: "capture.get-user-media",
        start_offset_ms: 110,
        duration_ms: 30,
      }),
      expect.objectContaining({
        name: "capture.first-frame-wait",
        start_offset_ms: 60,
        duration_ms: 25,
      }),
    ]);
  });

  it("retains at most 64 repeated slow spans without losing one-time phases", () => {
    install();
    openSessionTrace("bounded", {});
    recordPhase("bounded", "transcription.provider-transcribe", 0, 20, {
      slow: true,
      chunkIndex: 1,
    });
    for (let i = 0; i < 70; i++) {
      recordPhase("bounded", "transcription.provider-transcribe", 0, 21, {
        slow: true,
        chunkIndex: i + 2,
      });
    }
    recordPhase("bounded", "resolve.format", 40, 90);
    closeSessionTrace("bounded", { disposition: "success" });
    expect(flushed[0].trace_spans).toHaveLength(65);
    expect(flushed[0].trace_dropped_slow_span_count).toBe(6);
    expect(flushed[0].resolve_format_duration_ms).toBe(50);
  });

  it("settles a rejected promise without changing its error or adding a timing", async () => {
    install();
    openSessionTrace("promise", {});
    let reject!: (reason: unknown) => void;
    const error = new Error("private content");
    const work = tracePhase(
      "promise",
      "context.accessibility-refresh",
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    const caught = work.catch((reason) => reason);
    closeSessionTrace("promise", { disposition: "empty" });
    expect(flushed).toHaveLength(0);
    reject(error);
    expect(await caught).toBe(error);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].trace_spans).toEqual([]);
    expect(flushed[0].trace_unsettled_obligations).toEqual([]);
    expect(JSON.stringify(flushed[0])).not.toContain("private content");
  });

  it.each([false, true])(
    "waits for overlapping promise phases; last rejects=%s",
    async (lastRejects) => {
      install();
      openSessionTrace("overlap", {});
      const pending = [
        Promise.withResolvers<void>(),
        Promise.withResolvers<void>(),
      ];
      const tasks = pending.map((phase) =>
        tracePhase(
          "overlap",
          "context.accessibility-refresh",
          () => phase.promise,
        ),
      );
      const error = new Error("refresh failed");
      const last = tasks[1].catch((reason) => reason);
      closeSessionTrace("overlap", { disposition: "empty" });
      pending[0].resolve();
      await tasks[0];
      expect(flushed).toHaveLength(0);
      if (lastRejects) pending[1].reject(error);
      else pending[1].resolve();
      expect(await last).toBe(lastRejects ? error : undefined);
      expect(flushed).toHaveLength(1);
      expect(flushed[0].trace_spans).toHaveLength(lastRejects ? 1 : 2);
      expect(flushed[0].trace_unsettled_obligations).toEqual([]);
    },
  );

  it("identifies unfinished spans at grace and drops their late completion", async () => {
    vi.useFakeTimers();
    install();
    openSessionTrace("incomplete", {});
    const pending = Promise.withResolvers<void>();
    const work = tracePhase(
      "incomplete",
      "transcription.provider-warmup",
      () => pending.promise,
    );
    closeSessionTrace("incomplete", { disposition: "empty" });
    vi.advanceTimersByTime(15_000);
    expect(flushed[0].trace_unsettled_obligations).toEqual([
      "transcription.provider-warmup",
    ]);
    expect(flushed[0].trace_spans).toEqual([]);
    pending.resolve();
    await work;
    expect(flushed).toHaveLength(1);
    expect(flushed[0].trace_spans).toEqual([]);
  });

  it("does not attribute a later session failure to recovered warmup work", async () => {
    install();
    openSessionTrace("recovered", {});
    await tracePhase("recovered", "transcription.provider-warmup", async () => {
      throw new Error("warmup");
    }).catch(() => {});
    closeSessionTrace("recovered", {
      disposition: "failure",
      failedStage: "capture",
      errorCode: "MICROPHONE_PERMISSION_DENIED",
    });
    expect(flushed[0]).toMatchObject({
      failed_stage: "capture",
      error_code: "MICROPHONE_PERMISSION_DENIED",
    });
  });
});
