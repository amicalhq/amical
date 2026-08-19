import { Cause, Exit, Option } from "effect";
import type * as Tracer from "effect/Tracer";
import { setSpanEndSink } from "../runtime/telemetry-runtime";
import { logger } from "../logger";
import { codeOf, tagOf } from "../../types/errors";

/**
 * Per-session dictation trace: collects span records, obligation markers,
 * and point events for one recording session, then flushes ONE flattened
 * telemetry event — `transcription_completed`, fired on every disposition.
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
};

/** Records whose payload value is their END moment, relative to root (a
 * point's start and end coincide). */
const OFFSET_KEYS: Record<string, string> = {
  "lifecycle.recording-live": "recording_live_offset_ms",
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
  graceTimer: ReturnType<typeof setTimeout> | null;
  flushReason: "settled" | "grace" | null;
}

let telemetry: DictationTraceTelemetry | null = null;
const sessions = new Map<string, SessionTrace>();
let syntheticCounter = 0;

const nsToMs = (ns: bigint): number => Number(ns / 1_000_000n);

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
    rootClosed: false,
    rootClosedAt: null,
    disposition: null,
    closeFailedStage: null,
    closeErrorCode: null,
    latch: null,
    defect: false,
    chunks: null,
    graceTimer: null,
    flushReason: null,
  });
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

/** Synthetic duration record for promise-side phases (recorder start). */
export function recordPhase(
  sessionId: string,
  name: string,
  startedAt: number,
  endedAt: number,
): void {
  const trace = sessions.get(sessionId);
  if (!trace) {
    dropLate(sessionId, `phase:${name}`);
    return;
  }
  trace.records.push({
    sessionId,
    spanId: `phase-${++syntheticCounter}`,
    parentId: trace.rootSpanId,
    name,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    status: "ok",
    attributes: {},
  });
  if (trace.expected.has(name)) {
    trace.expected.set(name, true);
    maybeFlush(trace);
  }
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

  // Anchor discipline: every offset subtracts Date.now() moments (root
  // open, points, chunk stamps), but Effect's clock pins its wall origin
  // once at startup and only advances monotonically — a system clock step
  // after boot would skew span-derived offsets. Stamp the
  // end moment from Date.now() here (the sink runs synchronously inside
  // end()) and keep the duration on the monotonic clock.
  const endedAt = Date.now();
  const durationMs =
    span.status._tag === "Ended" ? nsToMs(endTime - span.status.startTime) : 0;
  const status = Exit.isSuccess(exit)
    ? "ok"
    : Cause.isInterruptedOnly(exit.cause)
      ? "interrupted"
      : "failed";
  const failure = Exit.isFailure(exit)
    ? Cause.failureOption(exit.cause)
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
    startedAt: endedAt - durationMs,
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

  const payload: Record<string, unknown> = {
    session_id: trace.sessionId,
    disposition: trace.disposition ?? "unknown",
    flush_reason: trace.flushReason ?? "settled",
    session_duration_ms:
      trace.rootClosedAt !== null
        ? trace.rootClosedAt - trace.rootStartedAt
        : undefined,
    ...trace.meta,
  };

  for (const record of trace.records) {
    const key = FLAT_KEYS[record.name];
    if (key !== undefined && payload[key] === undefined) {
      payload[key] = Math.round(record.durationMs);
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
