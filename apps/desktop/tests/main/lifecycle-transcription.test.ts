import { describe, expect, it, vi } from "vitest";
import {
  createTranscriptionAdapter,
  type StreamingTranscriptionService,
  type TranscriptionEnrichment,
} from "../../src/main/lifecycle/adapters/transcription";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";
import type { ResolvedStreamingSession } from "../../src/services/transcription-service";
import { AppError, ErrorCodes } from "../../src/types/error";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function resolved(text: string): ResolvedStreamingSession {
  return {
    text,
    language: "en",
    detectedLanguage: "en",
    speechModel: "whisper-tiny",
    formattingModel: undefined,
    meta: { source: "microphone", vocabularySize: 0 },
  };
}

function makeHarness(overrides: Partial<StreamingTranscriptionService> = {}) {
  const facts: LifecyclePortFact[] = [];
  const enrichments: Array<{
    session: string;
    fields: TranscriptionEnrichment;
  }> = [];
  const terminalCallbacks = new Map<string, (error: Error) => void>();

  const service: StreamingTranscriptionService = {
    beginStreamingSession: vi.fn((sessionId, onTerminalFailure) => {
      if (onTerminalFailure)
        terminalCallbacks.set(sessionId, onTerminalFailure);
      return true;
    }),
    processStreamingChunk: vi.fn(async () => ""),
    resolveStreamingSession: vi.fn(async () => resolved("hello world")),
    cancelStreamingSession: vi.fn(async () => undefined),
    resetVadForNewSession: vi.fn(async () => undefined),
    warmupActiveProvider: vi.fn(async () => undefined),
    ...overrides,
  };

  const adapter = createTranscriptionAdapter({
    sink: (fact) => facts.push(fact),
    service,
    enrich: (session, fields) => {
      enrichments.push({ session, fields });
    },
  });

  return { adapter, facts, enrichments, service, terminalCallbacks };
}

describe("lifecycle transcription adapter", () => {
  it("finalize resolves into a text transcriptionFinal and enriches the row", async () => {
    const h = makeHarness();
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    await settle();

    expect(h.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "text", text: "hello world" },
      },
    ]);
    expect(h.enrichments).toEqual([
      {
        session: "s1",
        fields: {
          language: "en",
          detectedLanguage: "en",
          speechModel: "whisper-tiny",
          formattingModel: null,
          metaPatch: { source: "microphone", vocabularySize: 0 },
        },
      },
    ]);
  });

  it("synthesizes empty for blank text, never-fed, and never-opened sessions", async () => {
    const blank = makeHarness({
      resolveStreamingSession: vi.fn(async () => resolved("   ")),
    });
    blank.adapter.open("s1");
    blank.adapter.finalize("s1");
    await settle();
    expect(blank.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "empty" },
      },
    ]);
    expect(blank.enrichments).toHaveLength(1);

    const neverFed = makeHarness({
      resolveStreamingSession: vi.fn(async () => null),
    });
    neverFed.adapter.open("s1");
    neverFed.adapter.finalize("s1");
    await settle();
    expect(neverFed.facts.at(-1)).toMatchObject({
      result: { kind: "empty" },
    });
    expect(neverFed.enrichments).toHaveLength(0);

    const neverOpened = makeHarness();
    neverOpened.adapter.finalize("ghost");
    expect(neverOpened.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "ghost",
        result: { kind: "empty" },
      },
    ]);

    // Idempotent: a repeat finalize on the never-opened session is a no-op.
    neverOpened.adapter.finalize("ghost");
    expect(neverOpened.facts).toHaveLength(1);
  });

  it("awaits enrichment before emitting the final fact", async () => {
    let releaseEnrich!: () => void;
    const enrichGate = new Promise<void>((resolve) => {
      releaseEnrich = resolve;
    });
    const facts: LifecyclePortFact[] = [];
    const adapter = createTranscriptionAdapter({
      sink: (fact) => facts.push(fact),
      service: makeHarness().service,
      enrich: () => enrichGate,
    });

    adapter.open("s1");
    adapter.finalize("s1");
    await settle();
    // The stamp rewrites meta; the fact (and with it the commit) must not
    // race the enrichment write.
    expect(facts).toEqual([]);

    releaseEnrich();
    await settle();
    expect(facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "text", text: "hello world" },
      },
    ]);
  });

  it("a refused stream open fails the session immediately", () => {
    const h = makeHarness({
      beginStreamingSession: vi.fn(() => false),
    });
    h.adapter.open("s1");
    expect(h.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "failure", cause: "UNKNOWN" },
      },
    ]);
  });

  it("maps resolve failures to error-code causes", async () => {
    const coded = makeHarness({
      resolveStreamingSession: vi.fn(async () => {
        throw new AppError("quota", ErrorCodes.QUOTA_EXCEEDED);
      }),
    });
    coded.adapter.open("s1");
    coded.adapter.finalize("s1");
    await settle();
    expect(coded.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "failure", cause: ErrorCodes.QUOTA_EXCEEDED },
      },
    ]);

    const uncoded = makeHarness({
      resolveStreamingSession: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    uncoded.adapter.open("s1");
    uncoded.adapter.finalize("s1");
    await settle();
    expect(uncoded.facts.at(-1)).toMatchObject({
      result: { kind: "failure", cause: ErrorCodes.UNKNOWN },
    });
  });

  it("an uncommanded terminal failure surfaces immediately, exactly once", async () => {
    const h = makeHarness();
    h.adapter.open("s1");
    h.terminalCallbacks.get("s1")!(
      new AppError("down", ErrorCodes.NETWORK_ERROR),
    );
    h.terminalCallbacks.get("s1")!(
      new AppError("down", ErrorCodes.NETWORK_ERROR),
    );

    expect(h.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "failure", cause: ErrorCodes.NETWORK_ERROR },
      },
    ]);

    // A later commanded finalize cannot double-fire.
    h.adapter.finalize("s1");
    await settle();
    expect(h.facts).toHaveLength(1);
  });

  it("cancel silences the stream: no fact from a late resolve or failure", async () => {
    let rejectResolve!: (error: unknown) => void;
    const h = makeHarness({
      resolveStreamingSession: vi.fn(
        () =>
          new Promise<ResolvedStreamingSession | null>((_, reject) => {
            rejectResolve = reject;
          }),
      ),
    });
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    h.adapter.cancel("s1");
    rejectResolve(new Error("aborted"));
    await settle();

    expect(h.facts).toEqual([]);
    expect(h.service.cancelStreamingSession).toHaveBeenCalledWith("s1");

    // Terminal callbacks after cancel are silent too.
    h.terminalCallbacks.get("s1")!(new Error("late"));
    expect(h.facts).toEqual([]);
  });

  it("feeds carry the draft latch and are fenced by session and state", async () => {
    const h = makeHarness();
    h.adapter.open("s1");
    h.adapter.feed("s1", new Float32Array(2));
    h.adapter.setDraft("s1", true);
    h.adapter.feed("s1", new Float32Array(2));
    h.adapter.feed("s0", new Float32Array(2)); // stale session
    h.adapter.cancel("s1");
    h.adapter.feed("s1", new Float32Array(2)); // after cancel

    const calls = vi.mocked(h.service.processStreamingChunk).mock.calls;
    expect(calls.map(([options]) => options.isInstruct)).toEqual([false, true]);
    expect(calls.every(([options]) => options.sessionId === "s1")).toBe(true);
  });

  it("a failed stream open surfaces as this session's failure", () => {
    const h = makeHarness({
      beginStreamingSession: vi.fn(() => {
        throw new Error("stale session still active");
      }),
    });
    h.adapter.open("s1");
    expect(h.facts).toEqual([
      {
        type: "transcriptionFinal",
        session: "s1",
        result: { kind: "failure", cause: ErrorCodes.UNKNOWN },
      },
    ]);
  });
});
