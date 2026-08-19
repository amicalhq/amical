import { describe, expect, it, vi } from "vitest";
import {
  createTranscriptionAdapter,
  type StreamingTranscriptionService,
  type TranscriptionEnrichment,
} from "../../src/main/lifecycle/adapters/transcription";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";
import { createSessionWork } from "../../src/main/lifecycle/effect/session-work";
import { FakeTimers } from "../helpers/lifecycle-fakes";
import type { ResolvedStreamingSession } from "../../src/services/transcription-service";
import { ErrorCodes } from "../../src/types/error";
import {
  CloudQuotaExceeded,
  IdleTimeout,
  NetworkFailure,
  ServerRejected,
  ServiceInitFailed,
} from "../../src/types/errors";
import {
  _resetDictationTraceForTests,
  installDictationTrace,
} from "../../src/main/telemetry/dictation-trace";

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

  const sessionWork = createSessionWork({ timers: new FakeTimers() });
  const service: StreamingTranscriptionService = {
    beginStreamingSession: vi.fn((sessionId, onTerminalFailure) => {
      // The runtime opens the region before the adapter opens the stream;
      // the harness mirrors that here so every test's session has one.
      sessionWork.open(sessionId);
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
    sessionWork,
    service,
    enrich: (session, fields) => {
      enrichments.push({ session, fields });
    },
  });

  return {
    adapter,
    sessionWork,
    facts,
    enrichments,
    service,
    terminalCallbacks,
  };
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
    const inlineHarness = makeHarness();
    const adapter = createTranscriptionAdapter({
      sink: (fact) => facts.push(fact),
      sessionWork: inlineHarness.sessionWork,
      service: inlineHarness.service,
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
        throw new CloudQuotaExceeded({ message: "quota" });
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
    h.terminalCallbacks.get("s1")!(new NetworkFailure({ message: "down" }));
    h.terminalCallbacks.get("s1")!(new NetworkFailure({ message: "down" }));

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

describe("session fences", () => {
  it("does not dispatch the VAD reset for a session already retired", async () => {
    const h = makeHarness();
    // Simulate the stale-open race: the region exists but retired before
    // the stream opens (a quick discard landing inside the same tick).
    const stale = vi.mocked(h.service.beginStreamingSession);
    stale.mockImplementationOnce(() => {
      h.sessionWork.open("s1");
      h.sessionWork.retire("s1");
      return true;
    });
    h.adapter.open("s1");
    await settle();
    expect(h.service.resetVadForNewSession).not.toHaveBeenCalled();

    // A live session still resets normally.
    h.adapter.open("s2");
    await settle();
    expect(h.service.resetVadForNewSession).toHaveBeenCalledTimes(1);
  });
});

// ---- Failure-funnel characterization pins --------------------------------
// The adapter's causeOf/detailOf funnel is the frozen edge that feeds the
// transcriptionFinal fact and the rich-toast detail channel. These rows pin
// its exact output contract, including the title/message gating asymmetry.

describe("failure funnel pins", () => {
  function makeFailureHarness(rejection: unknown) {
    const facts: LifecyclePortFact[] = [];
    const details: Array<{
      session: string;
      detail: { uiTitle?: string; uiMessage?: string; traceId?: string };
    }> = [];
    const sessionWork = createSessionWork({ timers: new FakeTimers() });
    const service: StreamingTranscriptionService = {
      beginStreamingSession: (sessionId) => {
        sessionWork.open(sessionId);
        return true;
      },
      processStreamingChunk: async () => "",
      resolveStreamingSession: async () => {
        throw rejection;
      },
      cancelStreamingSession: async () => undefined,
      resetVadForNewSession: async () => undefined,
      warmupActiveProvider: async () => undefined,
    };
    const adapter = createTranscriptionAdapter({
      sink: (fact) => facts.push(fact),
      sessionWork,
      service,
      enrich: () => undefined,
      onFailureDetail: (session, detail) => details.push({ session, detail }),
    });
    return { adapter, facts, details };
  }

  const failureCause = (facts: LifecyclePortFact[]): string => {
    const fact = facts.find((f) => f.type === "transcriptionFinal");
    if (!fact || fact.type !== "transcriptionFinal") {
      throw new Error("no transcriptionFinal fact");
    }
    if (fact.result.kind !== "failure") {
      throw new Error(`expected failure, got ${fact.result.kind}`);
    }
    return fact.result.cause;
  };

  it("forwards uiTitle, uiMessage, and traceId together", async () => {
    const h = makeFailureHarness(
      new CloudQuotaExceeded({
        message: "boom",
        meta: {
          serverUi: { title: "Title override", message: "Body override" },
          traceId: "trace-1",
        },
      }),
    );
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    await settle();
    expect(failureCause(h.facts)).toBe(ErrorCodes.QUOTA_EXCEEDED);
    expect(h.details).toEqual([
      {
        session: "s1",
        detail: {
          uiTitle: "Title override",
          uiMessage: "Body override",
          traceId: "trace-1",
        },
      },
    ]);
  });

  it("forwards a title without a message — the fields gate independently", async () => {
    const h = makeFailureHarness(
      new ServerRejected({
        message: "boom",
        meta: { httpStatus: 500, serverUi: { title: "Title only" } },
      }),
    );
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    await settle();
    expect(failureCause(h.facts)).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
    expect(h.details).toEqual([
      {
        session: "s1",
        detail: {
          uiTitle: "Title only",
          uiMessage: undefined,
          traceId: undefined,
        },
      },
    ]);
  });

  it("forwards a bare traceId", async () => {
    const h = makeFailureHarness(
      new NetworkFailure({ message: "boom", meta: { traceId: "trace-2" } }),
    );
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    await settle();
    expect(h.details[0]?.detail.traceId).toBe("trace-2");
  });

  it("emits no detail when the error carries none", async () => {
    const h = makeFailureHarness(new IdleTimeout({ message: "boom" }));
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    await settle();
    expect(failureCause(h.facts)).toBe(ErrorCodes.IDLE_TIMEOUT);
    expect(h.details).toEqual([]);
  });

  it("projects a foreign error to UNKNOWN with no detail", async () => {
    const h = makeFailureHarness(new TypeError("not an app error"));
    h.adapter.open("s1");
    h.adapter.finalize("s1");
    await settle();
    expect(failureCause(h.facts)).toBe(ErrorCodes.UNKNOWN);
    expect(h.details).toEqual([]);
  });

  describe("open() capture split", () => {
    function makeOpenThrowHarness(thrown: unknown) {
      const facts: LifecyclePortFact[] = [];
      const sessionWork = createSessionWork({ timers: new FakeTimers() });
      const service: StreamingTranscriptionService = {
        beginStreamingSession: () => {
          throw thrown;
        },
        processStreamingChunk: async () => "",
        resolveStreamingSession: async () => null,
        cancelStreamingSession: async () => undefined,
        resetVadForNewSession: async () => undefined,
        warmupActiveProvider: async () => undefined,
      };
      const adapter = createTranscriptionAdapter({
        sink: (fact) => facts.push(fact),
        sessionWork,
        service,
        enrich: () => undefined,
      });
      return { adapter, facts };
    }

    const failureCauseOf = (facts: LifecyclePortFact[]): string => {
      const fact = facts.find((f) => f.type === "transcriptionFinal");
      if (!fact || fact.type !== "transcriptionFinal") {
        throw new Error("no transcriptionFinal fact");
      }
      if (fact.result.kind !== "failure") {
        throw new Error(`expected failure, got ${fact.result.kind}`);
      }
      return fact.result.cause;
    };

    it("an unknown open-throw captures exactly once and projects UNKNOWN", () => {
      const captureException = vi.fn();
      installDictationTrace({
        trackDictationTrace: vi.fn(),
        captureException,
      });
      try {
        const bug = new TypeError("busy slot invariant");
        const h = makeOpenThrowHarness(bug);
        h.adapter.open("s1");
        expect(failureCauseOf(h.facts)).toBe(ErrorCodes.UNKNOWN);
        expect(captureException).toHaveBeenCalledExactlyOnceWith(bug, {
          source: "dictation",
          session_id: "s1",
        });
      } finally {
        _resetDictationTraceForTests();
      }
    });

    it("a typed open-throw (the degraded stub) never captures", () => {
      const captureException = vi.fn();
      installDictationTrace({
        trackDictationTrace: vi.fn(),
        captureException,
      });
      try {
        const h = makeOpenThrowHarness(
          new ServiceInitFailed({
            message: "Transcription service failed to initialize",
          }),
        );
        h.adapter.open("s1");
        expect(failureCauseOf(h.facts)).toBe(
          ErrorCodes.WORKER_INITIALIZATION_FAILED,
        );
        expect(captureException).not.toHaveBeenCalled();
      } finally {
        _resetDictationTraceForTests();
      }
    });
  });

  describe("finalize() capture discipline", () => {
    it("never captures — the resolve triage upstream owns defects", () => {
      const captureException = vi.fn();
      installDictationTrace({
        trackDictationTrace: vi.fn(),
        captureException,
      });
      try {
        const facts: LifecyclePortFact[] = [];
        const sessionWork = createSessionWork({ timers: new FakeTimers() });
        const service: StreamingTranscriptionService = {
          beginStreamingSession: (sessionId) => {
            sessionWork.open(sessionId);
            return true;
          },
          processStreamingChunk: async () => "",
          resolveStreamingSession: async () => {
            // A defect rethrown by the settle boundary — already captured
            // upstream by the resolve triage.
            throw new TypeError("already-triaged defect");
          },
          cancelStreamingSession: async () => undefined,
          resetVadForNewSession: async () => undefined,
          warmupActiveProvider: async () => undefined,
        };
        const adapter = createTranscriptionAdapter({
          sink: (fact) => facts.push(fact),
          sessionWork,
          service,
          enrich: () => undefined,
        });
        adapter.open("s1");
        adapter.finalize("s1");
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            const fact = facts.find((f) => f.type === "transcriptionFinal");
            expect(fact).toBeDefined();
            if (fact?.type === "transcriptionFinal") {
              expect(fact.result).toEqual({
                kind: "failure",
                cause: ErrorCodes.UNKNOWN,
              });
            }
            expect(captureException).not.toHaveBeenCalled();
            resolve();
          }, 0),
        );
      } finally {
        _resetDictationTraceForTests();
      }
    });
  });
});
