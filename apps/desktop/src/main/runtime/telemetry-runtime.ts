import { randomUUID } from "node:crypto";
import { Effect, Exit, Layer, Runtime, Scope, Tracer } from "effect";
import type * as Context from "effect/Context";
import * as Option from "effect/Option";

/**
 * The shared runtime for dictation-path fibers (lifecycle session work and
 * the transcription service streaming path).
 *
 * Built SYNCHRONOUSLY at module load: the tracer layer acquires no async
 * resources, so the first runFork/runPromise call already executes the
 * fiber's synchronous prefix. A lazily built runtime (ManagedRuntime) defers
 * the first call's synchronous prefix, which breaks zero-tick guarantees the
 * session code and its tests rely on. Pinned by telemetry-runtime.test.ts.
 */

/** Called once per finished span. The real sink (per-session accumulator +
 * telemetry flush) arrives with the instrumentation step; until then spans
 * flow through the tracer structurally and emit nothing. */
export type SpanEndSink = (
  span: Tracer.Span,
  exit: Exit.Exit<unknown, unknown>,
  endTime: bigint,
) => void;

let spanEndSink: SpanEndSink = () => {};

export function setSpanEndSink(next: SpanEndSink): void {
  spanEndSink = next;
}

let spanCounter = 0;

class DictationSpan implements Tracer.Span {
  readonly _tag = "Span" as const;
  readonly spanId: string;
  readonly traceId: string;
  readonly sampled = true;
  readonly attributes = new Map<string, unknown>();
  status: Tracer.SpanStatus;
  private readonly mutableLinks: Array<Tracer.SpanLink>;

  constructor(
    readonly name: string,
    readonly parent: Option.Option<Tracer.AnySpan>,
    readonly context: Context.Context<never>,
    links: ReadonlyArray<Tracer.SpanLink>,
    startTime: bigint,
    readonly kind: Tracer.SpanKind,
  ) {
    this.spanId = `span-${++spanCounter}`;
    // A root span mints its own trace id; children inherit the parent's, so
    // one dictation produces one trace (review finding — a shared constant
    // would merge every session into a single trace once spans land).
    this.traceId = Option.isSome(parent)
      ? parent.value.traceId
      : `trace-${randomUUID()}`;
    this.status = { _tag: "Started", startTime };
    this.mutableLinks = [...links];
  }

  get links(): ReadonlyArray<Tracer.SpanLink> {
    return this.mutableLinks;
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === "Ended") {
      return;
    }
    this.status = {
      _tag: "Ended",
      startTime: this.status.startTime,
      endTime,
      exit,
    };
    // The sink must never poison a dictation fiber: telemetry failures are
    // swallowed here and surfaced by the sink's own logging.
    try {
      spanEndSink(this, exit, endTime);
    } catch {
      // intentionally silent
    }
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value);
  }

  event(
    _name: string,
    _startTime: bigint,
    _attributes?: Record<string, unknown>,
  ): void {
    // Point events are emitted as standalone records by the sink layer, not
    // through span events.
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.mutableLinks.push(...links);
  }
}

const tracer = Tracer.make({
  span: (name, parent, context, links, startTime, kind) =>
    new DictationSpan(name, parent, context, links, startTime, kind),
  context: (f) => f(),
});

const runtimeScope = Effect.runSync(Scope.make());

export const telemetryRuntime: Runtime.Runtime<never> = Effect.runSync(
  Layer.toRuntime(Layer.setTracer(tracer)).pipe(Scope.extend(runtimeScope)),
);

export const runFork = Runtime.runFork(telemetryRuntime);
export const runPromise = Runtime.runPromise(telemetryRuntime);
export const runPromiseExit = Runtime.runPromiseExit(telemetryRuntime);
export const runSync = Runtime.runSync(telemetryRuntime);

/** Registered as an app-scope release when the sink lands (final flush lives
 * there); the tracer layer itself has no finalizers. */
export function closeTelemetryRuntime(): void {
  Effect.runSync(Scope.close(runtimeScope, Exit.void));
}
