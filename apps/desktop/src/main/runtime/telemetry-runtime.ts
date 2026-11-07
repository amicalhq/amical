import { randomUUID } from "node:crypto";
import { Context, Effect, Exit, Tracer } from "effect";
import * as Option from "effect/Option";

/**
 * The shared runtime for dictation-path fibers (lifecycle session work and
 * the transcription service streaming path).
 *
 * The tracer has no resources to acquire. A static context provides it to
 * root runners, which execute each fiber's synchronous prefix immediately.
 * Pinned by telemetry-runtime.test.ts.
 */

/** Called once per finished span. The real sink (per-session accumulator +
 * telemetry flush) arrives with the instrumentation step; until then spans
 * flow through the tracer structurally and emit nothing. */
export type SpanEndSink = (
  span: Tracer.Span,
  exit: Exit.Exit<unknown, unknown>,
  endTime: bigint,
  startedAt: number,
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
  readonly attributes = new Map<string, unknown>();
  status: Tracer.SpanStatus;
  private readonly startedAt = Date.now();
  private readonly mutableLinks: Array<Tracer.SpanLink>;

  constructor(
    readonly name: string,
    readonly parent: Option.Option<Tracer.AnySpan>,
    readonly annotations: Context.Context<never>,
    links: ReadonlyArray<Tracer.SpanLink>,
    startTime: bigint,
    readonly kind: Tracer.SpanKind,
    readonly sampled: boolean,
  ) {
    this.spanId = `span-${++spanCounter}`;
    // A root span mints its own trace id; children inherit the parent's, so
    // one dictation produces one trace. A shared constant would merge every
    // session into a single trace once spans land.
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
      spanEndSink(this, exit, endTime, this.startedAt);
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
  span: ({ name, parent, annotations, links, startTime, kind, sampled }) =>
    new DictationSpan(
      name,
      parent,
      annotations,
      links,
      startTime,
      kind,
      sampled,
    ),
});

const telemetryContext = Context.make(Tracer.Tracer, tracer);

export const runFork = Effect.runForkWith(telemetryContext);
export const runPromise = Effect.runPromiseWith(telemetryContext);
export const runPromiseExit = Effect.runPromiseExitWith(telemetryContext);
