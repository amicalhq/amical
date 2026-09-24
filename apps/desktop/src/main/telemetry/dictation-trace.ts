import { Cause, Exit, Option } from "effect";
import type * as Tracer from "effect/Tracer";
import type {
  AudioContextTelemetry,
  CaptureTimingsBatch,
} from "../../types/capture-timings";
import { setSpanEndSink } from "../runtime/telemetry-runtime";
import { logger } from "../logger";
import { codeOf, tagOf } from "../../types/errors";

/**
 * Per-session dictation trace: collects span records, obligation markers,
 * and point events for one recording session, then flushes ONE summary and waterfall
 * telemetry event — `transcription_completed_v2`, fired on every disposition.
 *
 * Flush policy: flush when the root is closed AND every expected obligation
 * has settled, or GRACE_MS after root close, whichever comes first; exactly
 * once; the entry is deleted at flush; anything arriving later logs at debug
 * and is dropped — never recreated, never a second event.
 */

export interface SpanRecord {
  sessionId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: "ok" | "failed" | "interrupted";
  attributes: Record<string, unknown>;
  process?: "main" | "renderer";
  point?: boolean;
}

export interface ChunkAggregate {
  modelId: string | null;
  provider: string | null;
  count: number;
  vadMsSum: number;
  vadMsMax: number;
  transcribeMsSum: number;
  transcribeMsMax: number;
  materializeMs: number;
  firstChunkAt: number | null;
  lastChunkAt: number | null;
}

export interface DictationTraceTelemetry {
  trackDictationTrace(properties: Record<string, unknown>): void;
  captureException?(
    error: unknown,
    additionalProperties?: Record<string, unknown>,
  ): void;
}

const GRACE_MS = 15_000;
const SLOW_SPAN_THRESHOLD_MS = 20;
const MAX_SLOW_SPANS = 64;
const LATCH_EVENT = "transcription.terminal-latch";

/** Naming scheme: `*_duration_ms` is a span length; `*_offset_ms` is a
 * moment relative to the ROOT start (session open) — the single anchor for
 * every offset. Child spans carry their parent prefix because the payload
 * is flat. Durations of concurrent phases must not be summed. */
const FLAT_KEYS: Record<string, string> = {
  "lifecycle.mute-ambiance": "mute_duration_ms",
  "lifecycle.recorder-spinup": "recorder_spinup_duration_ms",
  "lifecycle.recorder-close": "recorder_close_duration_ms",
  // The whole delivery (effect start → native confirmation), NOT the
  // delivery.paste span — that span ends at dispatch (the staged fact the
  // reducer waits on cannot hang on the native layer) and ends ok even when
  // nothing pasted, so it feeds no payload key. Unconfirmed paste = both
  // paste keys omitted.
  "delivery.pasted": "paste_duration_ms",
  "storage.commit": "storage_duration_ms",
  "lifecycle.unmute-ambiance": "unmute_duration_ms",
  "transcription.resolve": "resolve_duration_ms",
  "resolve.drain": "resolve_drain_duration_ms",
  "resolve.flush": "resolve_flush_duration_ms",
  "resolve.format": "resolve_format_duration_ms",
  "lifecycle.recorder-start-gate-wait": "recorder_start_gate_wait_duration_ms",
  "capture.enumerate-devices": "capture_enumerate_devices_duration_ms",
  "capture.get-user-media": "capture_get_user_media_duration_ms",
  "capture.audio-context-create": "capture_audio_context_create_duration_ms",
  "capture.audio-context-resume": "capture_audio_context_resume_duration_ms",
  "capture.first-frame-wait": "capture_first_frame_wait_duration_ms",
  "native.start-recording.rpc": "native_start_recording_rpc_duration_ms",
  "native.stop-recording.rpc": "native_stop_recording_rpc_duration_ms",
  "context.accessibility-refresh": "accessibility_refresh_duration_ms",
  "context.draft-selection-copy": "draft_selection_copy_duration_ms",
  "resolve.draft-selection-wait": "draft_selection_wait_duration_ms",
  "transcription.provider-warmup": "provider_warmup_duration_ms",
};

/** Records whose payload value is their END moment, relative to root (a
 * point's start and end coincide). */
const OFFSET_KEYS: Record<string, string> = {
  "lifecycle.recording-live": "recording_live_offset_ms",
  "lifecycle.recording-stopping": "recording_stopping_offset_ms",
  "lifecycle.first-accepted-frame": "first_accepted_frame_offset_ms",
  // The user-felt delivery moment (native layer confirmed the paste);
  // stop-to-pasted is pasted_offset_ms - last_chunk_offset_ms. A paste
  // confirmed after the trace flushed is dropped: omitted, never faked.
  "delivery.pasted": "pasted_offset_ms",
};

interface SessionTrace {
  sessionId: string;
  rootSpanId: string;
  rootStartedAt: number;
  meta: Record<string, unknown>;
  records: SpanRecord[];
  expected: Map<string, boolean>;
  pendingPhases: Map<string, number>;
  rootClosed: boolean;
  rootClosedAt: number | null;
  disposition: string | null;
  closeFailedStage: string | null;
  closeErrorCode: string | null;
  latch: {
    stage: string;
    errorCode: string | null;
    errorTag: string | null;
  } | null;
  /** A defect occurred during this session (independent of the disposition). */
  defect: boolean;
  chunks: ChunkAggregate | null;
  captureInfo: Record<string, unknown> | null;
  audioContext: AudioContextTelemetry | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  flushReason: "settled" | "grace" | null;
  slowSpanCount: number;
  droppedSlowSpanCount: number;
}

let telemetry: DictationTraceTelemetry | null = null;
const sessions = new Map<string, SessionTrace>();
let syntheticCounter = 0;

const roundMs = (ms: number): number => Math.round(ms * 1000) / 1000;

const dropLate = (sessionId: string, what: string): void => {
  logger.transcription.debug("Dictation trace record after flush; dropped", {
    sessionId,
    what,
  });
};

/** Wire the span sink and the flush target. Called once at boot. */
export function installDictationTrace(target: DictationTraceTelemetry): void {
  telemetry = target;
  setSpanEndSink(handleSpanEnd);
}

export function openSessionTrace(
  sessionId: string,
  meta: Record<string, unknown>,
): void {
  if (sessions.has(sessionId)) {
    return;
  }
  sessions.set(sessionId, {
    sessionId,
    rootSpanId: `root-${++syntheticCounter}`,
    rootStartedAt: Date.now(),
    meta,
    records: [],
    expected: new Map(),
    pendingPhases: new Map(),
    rootClosed: false,
    rootClosedAt: null,
    disposition: null,
    closeFailedStage: null,
    closeErrorCode: null,
    latch: null,
    defect: false,
    chunks: null,
    captureInfo: null,
    audioContext: null,
    graceTimer: null,
    flushReason: null,
    slowSpanCount: 0,
    droppedSlowSpanCount: 0,
  });
}

/** Preserve the historical session-open boundary after registering early
 * enough to collect synchronous warmup spans. Earlier spans have negative offsets. */
export function markSessionTraceAnchor(sessionId: string): void {
  const trace = sessions.get(sessionId);
  if (trace && !trace.rootClosed) trace.rootStartedAt = Date.now();
}

/** Register an expected obligation. Call in the fork's synchronous prefix. */
export function expectObligation(sessionId: string, name: string): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, `expect:${name}`);
    return;
  }
  if (!trace.expected.has(name)) {
    trace.expected.set(name, false);
  }
}

/** Settle an expected obligation WITHOUT a record: the outcome could not be
 * confirmed (a refused or rejected paste), so its keys stay omitted — never
 * faked — and the trace does not wait out the grace window for it. */
export function settleObligation(sessionId: string, name: string): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, `settle:${name}`);
    return;
  }
  if (trace.expected.has(name)) {
    trace.expected.set(name, true);
    maybeFlush(trace);
  }
}

/** Zero-duration point event. The terminal-latch event carries the true
 * failure stage and wins attribution over a later failing resolve span. */
export function recordPoint(
  sessionId: string,
  name: string,
  attributes: Record<string, unknown> = {},
): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, `point:${name}`);
    return;
  }
  // Format metadata accompanies every PCM frame. Keep its latest value;
  // it is not a timing milestone and must not grow the waterfall per frame.
  if (name === "lifecycle.audio-capture") {
    trace.captureInfo = attributes;
    return;
  }
  const now = Date.now();
  trace.records.push({
    sessionId,
    spanId: `point-${++syntheticCounter}`,
    parentId: trace.rootSpanId,
    name,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    status: "ok",
    attributes,
    point: true,
  });
  if (name === LATCH_EVENT && !trace.latch) {
    trace.latch = {
      stage: String(attributes.stage ?? "unknown"),
      errorCode:
        typeof attributes.errorCode === "string" ? attributes.errorCode : null,
      errorTag:
        typeof attributes.errorTag === "string" ? attributes.errorTag : null,
    };
  }
}

export interface PhaseOptions {
  chunkIndex?: number;
  slow?: boolean;
  durationMs?: number;
}

/** Start/end timestamps are Unix epoch milliseconds for session offsets. */
export function recordPhase(
  sessionId: string,
  name: string,
  startedAt: number,
  endedAt: number,
  options: PhaseOptions = {},
): void {
  const durationMs = options.durationMs ?? endedAt - startedAt;
  // Fast chunk work needs no record allocation or session lookup.
  if (options.slow && durationMs <= SLOW_SPAN_THRESHOLD_MS) return;
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, `phase:${name}`);
    return;
  }
  if (options.slow) {
    if (trace.slowSpanCount >= MAX_SLOW_SPANS) {
      trace.droppedSlowSpanCount++;
      return;
    }
    trace.slowSpanCount++;
  }
  trace.records.push({
    sessionId,
    spanId: `phase-${++syntheticCounter}`,
    parentId: trace.rootSpanId,
    name,
    startedAt,
    endedAt,
    durationMs,
    status: "ok",
    attributes: { chunkIndex: options.chunkIndex },
  });
  if (trace.expected.has(name) && !trace.pendingPhases.has(name))
    trace.expected.set(name, true);
  maybeFlush(trace);
}

/** Time successful promise work; always settle its reporting obligation. */
export async function tracePhase<T>(
  sessionId: string,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  // Do not retain the session record while work awaits past the grace period.
  {
    const trace = sessions.get(sessionId);
    if (trace) {
      trace.pendingPhases.set(name, (trace.pendingPhases.get(name) ?? 0) + 1);
      trace.expected.set(name, false);
    }
  }
  const startedAt = Date.now();
  const timerStartedAt = performance.now();
  try {
    const result = await work();
    recordPhase(sessionId, name, startedAt, Date.now(), {
      durationMs: performance.now() - timerStartedAt,
    });
    return result;
  } finally {
    const trace = sessions.get(sessionId);
    if (trace) {
      const remaining = (trace.pendingPhases.get(name) ?? 1) - 1;
      if (remaining > 0) trace.pendingPhases.set(name, remaining);
      else {
        trace.pendingPhases.delete(name);
        settleObligation(sessionId, name);
      }
    }
  }
}

/** Import the full renderer batch before its reporting obligation settles. */
export function recordCapturePhases(
  sessionId: string,
  phases: CaptureTimingsBatch["phases"],
): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, "capture:phases");
    return;
  }
  for (const phase of phases) {
    trace.records.push({
      sessionId,
      spanId: `phase-${++syntheticCounter}`,
      parentId: trace.rootSpanId,
      name: phase.name,
      startedAt: phase.startedAtMs,
      endedAt: phase.startedAtMs + phase.durationMs,
      durationMs: phase.durationMs,
      status: "ok",
      attributes: {},
      process: "renderer",
    });
  }
}

/** Renderer batches carry cumulative snapshots, including repeated summaries. */
export function recordAudioContextTelemetry(
  sessionId: string,
  audioContext: AudioContextTelemetry,
): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, "capture:audio-context");
    return;
  }
  trace.audioContext = { ...audioContext };
}

/**
 * Mark that a defect occurred during this session. Additive to the
 * disposition: the trace keeps the code of what the user saw, and
 * `defect: true` says a bug also fired (capture happens at the reporting
 * site, not here).
 */
export function recordDefect(sessionId: string): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, "defect");
    return;
  }
  trace.defect = true;
}

/**
 * Defect reporting channel for main-process sites with no telemetry
 * dependency of their own (the lifecycle adapter's capture split): loud
 * log + exception capture + the additive trace flag, in one call.
 */
export function reportDictationDefect(
  sessionId: string,
  defect: unknown,
): void {
  logger.transcription.error("Dictation defect", { sessionId, defect });
  telemetry?.captureException?.(defect, {
    source: "dictation",
    session_id: sessionId,
  });
  recordDefect(sessionId);
}

/** The per-session chunk aggregate, emitted once at retirement.
 * A second call for the same session is dropped — frozen after emit. */
export function recordChunkAggregate(
  sessionId: string,
  aggregate: ChunkAggregate,
): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, "chunks");
    return;
  }
  if (trace.chunks) {
    return;
  }
  trace.chunks = aggregate;
  maybeFlush(trace);
}

export function closeSessionTrace(
  sessionId: string,
  close: {
    disposition: string;
    failedStage?: string;
    errorCode?: string;
  },
): void {
  const trace = sessions.get(sessionId);
  if (!trace || trace.rootClosed) {
    return;
  }
  trace.rootClosed = true;
  trace.rootClosedAt = Date.now();
  trace.disposition = close.disposition;
  trace.closeFailedStage = close.failedStage ?? null;
  trace.closeErrorCode = close.errorCode ?? null;
  if (!maybeFlush(trace)) {
    trace.graceTimer = setTimeout(() => {
      trace.flushReason = "grace";
      flush(trace);
    }, GRACE_MS);
    // Never hold the process open for telemetry (quit, test teardown).
    trace.graceTimer.unref?.();
  }
}

function handleSpanEnd(
  span: Tracer.Span,
  exit: Exit.Exit<unknown, unknown>,
  endTime: bigint,
  startedAt: number,
): void {
  const sessionId = span.attributes.get("sessionId");
  if (typeof sessionId !== "string") {
    return;
  }
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, `span:${span.name}`);
    return;
  }

  const durationMs =
    span.status._tag === "Ended"
      ? Number(endTime - span.status.startTime) / 1_000_000
      : 0;
  const endedAt = startedAt + durationMs;
  const status = Exit.isSuccess(exit)
    ? "ok"
    : Cause.hasInterruptsOnly(exit.cause)
      ? "interrupted"
      : "failed";
  const failure = Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause)
    : Option.none();
  // The projection owns coding now: variants project their frozen code and
  // carry their tag; foreign values project UNKNOWN (the foreign-`.code`
  // passthrough is superseded — decided carve-out).
  const failureValue = Option.isSome(failure) ? failure.value : null;
  const errorCode = failureValue !== null ? codeOf(failureValue) : undefined;
  const errorTag = failureValue !== null ? tagOf(failureValue) : undefined;

  trace.records.push({
    sessionId,
    spanId: span.spanId,
    // Native fiber parentage wins (resolve children); everything else hangs
    // off the synthetic root to keep sink-side stitching consistent.
    parentId:
      Option.isSome(span.parent) && span.parent.value._tag === "Span"
        ? span.parent.value.spanId
        : trace.rootSpanId,
    name: span.name,
    startedAt,
    endedAt,
    durationMs,
    status,
    // Allowlist, never spread: effect injects code.stacktrace on failed
    // spans, and the record-content contract is names/timestamps/status/
    // code/sessionId only.
    attributes: {
      sessionId,
      ...(errorCode ? { errorCode } : {}),
      ...(errorTag ? { errorTag } : {}),
    },
  });

  if (trace.expected.has(span.name)) {
    trace.expected.set(span.name, true);
  }
  maybeFlush(trace);
}

function maybeFlush(trace: SessionTrace): boolean {
  if (!trace.rootClosed) {
    return false;
  }
  for (const settled of trace.expected.values()) {
    if (!settled) {
      return false;
    }
  }
  trace.flushReason = "settled";
  flush(trace);
  return true;
}

function flush(trace: SessionTrace): void {
  if (!sessions.has(trace.sessionId)) {
    return;
  }
  sessions.delete(trace.sessionId);
  if (trace.graceTimer) {
    clearTimeout(trace.graceTimer);
    trace.graceTimer = null;
  }

  const recordedSpanIds = new Set(trace.records.map((record) => record.spanId));
  const payload: Record<string, unknown> = {
    session_id: trace.sessionId,
    disposition: trace.disposition ?? "unknown",
    flush_reason: trace.flushReason ?? "settled",
    session_duration_ms:
      trace.rootClosedAt !== null
        ? trace.rootClosedAt - trace.rootStartedAt
        : undefined,
    ...trace.meta,
    trace_schema_version: 1,
    trace_offset_anchor: "session_open",
    trace_slow_span_threshold_ms: SLOW_SPAN_THRESHOLD_MS,
    trace_slow_span_limit: MAX_SLOW_SPANS,
    trace_dropped_slow_span_count: trace.droppedSlowSpanCount,
    trace_unsettled_obligations: [...trace.expected]
      .filter(([, settled]) => !settled)
      .map(([name]) => name),
    trace_spans: trace.records
      .filter((record) => !record.point)
      .map((record) => ({
        span_id: record.spanId,
        parent_span_id:
          record.parentId && recordedSpanIds.has(record.parentId)
            ? record.parentId
            : trace.rootSpanId,
        name: record.name,
        process: record.process ?? "main",
        duration_ms: roundMs(record.durationMs),
        status: record.status,
        start_offset_ms: roundMs(record.startedAt - trace.rootStartedAt),
        ...(typeof record.attributes.chunkIndex === "number"
          ? { chunk_index: record.attributes.chunkIndex }
          : {}),
      })),
    trace_points: trace.records
      .filter((record) => record.point)
      .map((record) => ({
        name: record.name,
        offset_ms: roundMs(record.startedAt - trace.rootStartedAt),
        process: "main",
      })),
    trace_root_span_id: trace.rootSpanId,
  };

  if (trace.captureInfo) {
    payload.audio_input_channel_count = trace.captureInfo.inputChannelCount;
    payload.audio_track_channel_count = trace.captureInfo.trackChannelCount;
    payload.audio_stereo_downmix_enabled =
      trace.captureInfo.stereoDownmixEnabled;
  }
  if (trace.audioContext) {
    const audioContext = trace.audioContext;
    payload.audio_context_recovery_attempt_count =
      audioContext.recoveryAttemptCount;
    payload.audio_context_recovery_success_count =
      audioContext.recoverySuccessCount;
    payload.audio_context_recovery_failure_count =
      audioContext.recoveryFailureCount;
    payload.audio_context_recovery_duration_ms = roundMs(
      audioContext.recoveryDurationMs,
    );
    if (audioContext.failureOperation !== undefined) {
      payload.audio_context_failure_operation = audioContext.failureOperation;
    }
    if (audioContext.failureState !== undefined) {
      payload.audio_context_failure_state = audioContext.failureState;
    }
  }
  for (const record of trace.records) {
    if (record.name === "lifecycle.ambiance-config") {
      payload.dictation_sounds_enabled =
        record.attributes.dictationSoundsEnabled;
      payload.system_audio_mute_enabled =
        record.attributes.systemAudioMuteEnabled;
    }
    const key = FLAT_KEYS[record.name];
    if (key !== undefined && payload[key] === undefined) {
      payload[key] = Math.round(record.durationMs);
      const startKey = key.replace(/_duration_ms$/, "_start_offset_ms");
      payload[startKey] = roundMs(record.startedAt - trace.rootStartedAt);
    }
    const offsetKey = OFFSET_KEYS[record.name];
    if (offsetKey !== undefined && payload[offsetKey] === undefined) {
      payload[offsetKey] = Math.round(record.endedAt - trace.rootStartedAt);
    }
  }

  if (trace.chunks) {
    if (trace.chunks.modelId !== null) {
      payload.model_id = trace.chunks.modelId;
    }
    if (trace.chunks.provider !== null) {
      payload.provider = trace.chunks.provider;
    }
    payload.chunk_count = trace.chunks.count;
    payload.vad_duration_sum_ms = Math.round(trace.chunks.vadMsSum);
    payload.vad_duration_max_ms = Math.round(trace.chunks.vadMsMax);
    payload.transcribe_duration_sum_ms = Math.round(
      trace.chunks.transcribeMsSum,
    );
    payload.transcribe_duration_max_ms = Math.round(
      trace.chunks.transcribeMsMax,
    );
    payload.materialize_duration_ms = Math.round(trace.chunks.materializeMs);
    if (trace.chunks.firstChunkAt !== null) {
      payload.first_chunk_offset_ms =
        trace.chunks.firstChunkAt - trace.rootStartedAt;
    }
    if (trace.chunks.lastChunkAt !== null) {
      payload.last_chunk_offset_ms =
        trace.chunks.lastChunkAt - trace.rootStartedAt;
    }
  }

  // Attribution priority: the terminal-latch point event carries
  // the true stage; a failing span is the fallback; close args come last.
  // Gated on an actual failure disposition: a dismissed session can reject
  // an in-flight provider call, and that must not read as a stage failure.
  const isFailure = trace.latch !== null || trace.disposition === "failure";
  if (isFailure) {
    const failedRecord = trace.records.find((r) => r.status === "failed");
    const failedStage =
      trace.latch?.stage ?? failedRecord?.name ?? trace.closeFailedStage;
    const errorCode =
      trace.latch?.errorCode ??
      (failedRecord?.attributes.errorCode as string | undefined) ??
      trace.closeErrorCode;
    if (failedStage) {
      payload.failed_stage = failedStage;
    }
    if (errorCode) {
      payload.error_code = errorCode;
    }
    const errorTag =
      trace.latch?.errorTag ??
      (failedRecord?.attributes.errorTag as string | undefined);
    if (errorTag) {
      payload.error_tag = errorTag;
    }
  }
  if (trace.defect) {
    payload.defect = true;
  }

  logger.transcription.debug("Dictation trace", {
    payload,
    records: trace.records,
  });
  telemetry?.trackDictationTrace(payload);
}

/** Force-flush every open trace (app shutdown): sessions in flight at quit
 * must not lose their event. Closed-but-waiting traces flush as-is; still-
 * open traces close with disposition "shutdown" first. */
export function flushAllDictationTraces(): void {
  for (const trace of [...sessions.values()]) {
    if (!trace.rootClosed) {
      trace.rootClosed = true;
      trace.rootClosedAt = Date.now();
      trace.disposition = "shutdown";
    }
    trace.flushReason = trace.flushReason ?? "grace";
    flush(trace);
  }
}

/** Test support: drop all state and the installed sink target. */
export function _resetDictationTraceForTests(): void {
  for (const trace of sessions.values()) {
    if (trace.graceTimer) {
      clearTimeout(trace.graceTimer);
    }
  }
  sessions.clear();
  telemetry = null;
  setSpanEndSink(() => {});
}
