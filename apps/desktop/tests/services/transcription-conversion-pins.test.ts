import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenTranscriptionSessionOptions,
  TranscribeContext,
  TranscribeParams,
  TranscriptionOutput,
} from "../../src/pipeline/core/pipeline-types";

/**
 * Conversion pins (plan S0, D16): behaviors the Effect conversion must keep
 * that no existing suite pins. Written and green against the CURRENT
 * promise/async-mutex implementation; every later step gates on this file
 * passing unmodified.
 *
 * Pin 1 — chunk arrival order under lock contention (transcript order).
 * Pin 2 — lock identity: an in-flight chunk transcribe from a cancelled
 *         session still blocks a started history retry (one lock, not two).
 * Pin 3 — a chunk failure during drain latches BEFORE drain unblocks, and
 *         resolve rejects with the exact latched object.
 */

const providerMocks = vi.hoisted(() => {
  const makeSession = (
    name: string,
    defaultFinalText: string,
    options: OpenTranscriptionSessionOptions,
  ) => ({
    name,
    sessionId: options.sessionId,
    transcribe: vi.fn<
      (params: TranscribeParams) => Promise<TranscriptionOutput>
    >(async () => ({ text: "" })),
    flush: vi.fn<
      (
        context: TranscribeContext,
        signal?: AbortSignal,
      ) => Promise<TranscriptionOutput>
    >(async () => ({ text: defaultFinalText })),
    cancel: vi.fn<() => void>(),
    updateSessionContext: vi.fn<(context: TranscribeContext) => Promise<void>>(
      async () => undefined,
    ),
    emitTerminalFailure: (error: Error) => options.onTerminalFailure?.(error),
  });

  const makeProvider = (name: string, defaultFinalText: string) => {
    const sessions = new Map<string, ReturnType<typeof makeSession>>();
    const sessionSetups = new Map<
      string,
      (session: ReturnType<typeof makeSession>) => void
    >();
    const openSession = vi.fn((options: OpenTranscriptionSessionOptions) => {
      const session = makeSession(name, defaultFinalText, options);
      sessionSetups.get(options.sessionId)?.(session);
      sessionSetups.delete(options.sessionId);
      sessions.set(options.sessionId, session);
      return session;
    });

    return {
      name,
      sessions,
      openSession,
      warmup: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      preloadModel: vi.fn(async () => undefined),
      setupSession(
        sessionId: string,
        setup: (session: ReturnType<typeof makeSession>) => void,
      ) {
        sessionSetups.set(sessionId, setup);
      },
      resetTestState() {
        sessions.clear();
        sessionSetups.clear();
      },
    };
  };

  return {
    local: makeProvider("whisper-local", "local final"),
    cloud: makeProvider("amical-cloud", "cloud final"),
  };
});

vi.mock("../../src/db/transcriptions", () => ({
  getTranscriptionById: vi.fn(),
  updateTranscription: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

vi.mock("../../src/services/transcription/load-dictation-context", () => ({
  loadDictationContext: vi.fn(),
}));

vi.mock(
  "../../src/services/transcription/prepare-transcript-text",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/transcription/prepare-transcript-text")
    >()),
    prepareTranscriptText: vi.fn(),
  }),
);

vi.mock("../../src/pipeline/providers/transcription/whisper-provider", () => ({
  WhisperProvider: vi.fn(function () {
    return providerMocks.local;
  }),
}));

vi.mock(
  "../../src/pipeline/providers/transcription/amical-cloud-provider",
  () => ({
    AmicalCloudProvider: vi.fn(function () {
      return providerMocks.cloud;
    }),
  }),
);

import { getTranscriptionById } from "../../src/db/transcriptions";
import type { AuthService } from "../../src/services/auth-service";
import type { ModelService } from "../../src/services/model-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import { TranscriptionService } from "../../src/services/transcription-service";
import { setSpanEndSink } from "../../src/main/runtime/telemetry-runtime";
import { loadDictationContext } from "../../src/services/transcription/load-dictation-context";
import { prepareTranscriptText } from "../../src/services/transcription/prepare-transcript-text";
import type { DictationContext } from "../../src/services/transcription/types";
import type { VADService } from "../../src/services/vad-service";
import * as fs from "node:fs";

const dictationContext = (sessionId: string): DictationContext => ({
  sessionId,
  vocabulary: [],
  replacements: new Map(),
  formattingStyle: "formal",
  audio: { source: "microphone" },
  accessibilityContext: null,
  cloudFormattingEnabled: false,
  isInstruct: false,
});

const historyRecord = () =>
  ({
    id: 1,
    audioFile: "/tmp/retry.wav",
    text: "",
    detectedLanguage: null,
    language: null,
    meta: {},
  }) as unknown as Awaited<ReturnType<typeof getTranscriptionById>>;

const deferred = <T>() => {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
};

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("TranscriptionService — conversion pins", () => {
  let service: TranscriptionService;
  let processVadFrame: ReturnType<typeof vi.fn>;
  let vadReset: ReturnType<typeof vi.fn>;

  const processChunk = (sessionId: string, sample: number) =>
    service.processStreamingChunk({
      sessionId,
      audioChunk: new Float32Array([sample]),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.local.resetTestState();
    providerMocks.cloud.resetTestState();

    const modelService = {
      getSelectedModel: vi.fn(async () => null),
    };
    const settingsService = {
      getFormatterConfig: vi.fn(async () => ({ enabled: false })),
    };
    const telemetryService = new Proxy({}, { get: () => vi.fn() });
    processVadFrame = vi.fn(async () => ({
      probability: 1,
      isSpeaking: true,
    }));
    vadReset = vi.fn();

    service = TranscriptionService.createForTests(
      modelService as unknown as ModelService,
      {
        processAudioFrame: processVadFrame,
        reset: vadReset,
      } as unknown as VADService,
      settingsService as unknown as SettingsService,
      telemetryService as unknown as TelemetryService,
      {
        isAuthenticated: vi.fn(),
        getIdToken: vi.fn(),
        refreshTokenIfNeeded: vi.fn(),
      } as unknown as AuthService,
      null,
      null,
    );
    vi.mocked(loadDictationContext).mockImplementation(async (options) =>
      dictationContext(options.sessionId ?? "retry-session"),
    );
    vi.mocked(prepareTranscriptText).mockImplementation(
      async ({ text, context, detectedLanguage }) => ({
        text,
        language:
          context.languages?.length === 1 ? context.languages[0] : "auto",
        detectedLanguage: detectedLanguage?.trim() || undefined,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        formattingUsed: false,
      }),
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    const wav = Buffer.alloc(46);
    wav.writeInt16LE(3277, 44);
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(wav);
    vi.mocked(getTranscriptionById).mockResolvedValue(historyRecord());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pin 1: two contending chunks transcribe in arrival order", async () => {
    const firstTranscribe = deferred<TranscriptionOutput>();
    providerMocks.local.setupSession("order-session", (session) => {
      session.transcribe.mockImplementationOnce(() => firstTranscribe.promise);
    });

    expect(service.beginStreamingSession("order-session")).toBe(true);
    const chunkA = processChunk("order-session", 1);
    await settle();

    const providerSession = providerMocks.local.sessions.get("order-session");
    expect(providerSession).toBeDefined();
    expect(providerSession!.transcribe).toHaveBeenCalledTimes(1);

    const chunkB = processChunk("order-session", 2);
    await settle();
    // Chunk B must wait for the lock; its transcribe has not started.
    expect(providerSession!.transcribe).toHaveBeenCalledTimes(1);

    firstTranscribe.resolve({ text: "first " });
    await Promise.all([chunkA, chunkB]);

    expect(providerSession!.transcribe).toHaveBeenCalledTimes(2);
    const order = providerSession!.transcribe.mock.calls.map(
      (call) => call[0].audioData[0],
    );
    expect(order).toEqual([1, 2]);
  });

  it("pin 2: an in-flight chunk from a cancelled session blocks a started retry until it settles", async () => {
    const gatedTranscribe = deferred<TranscriptionOutput>();
    providerMocks.local.setupSession("zombie-session", (session) => {
      session.transcribe.mockImplementationOnce(() => gatedTranscribe.promise);
    });

    expect(service.beginStreamingSession("zombie-session")).toBe(true);
    const zombieChunk = processChunk("zombie-session", 1);
    await settle();
    expect(
      providerMocks.local.sessions.get("zombie-session")!.transcribe,
    ).toHaveBeenCalledTimes(1);

    // Cancel frees the slot, but the in-flight transcribe still holds the lock.
    await service.cancelStreamingSession("zombie-session");

    const retry = service.retryTranscription(1);
    let retrySettled = false;
    void retry.then(
      () => {
        retrySettled = true;
      },
      () => {
        retrySettled = true;
      },
    );
    await settle();
    // The retry must not reach its provider work while the zombie holds the lock.
    expect(providerMocks.local.openSession).toHaveBeenCalledTimes(1);
    expect(retrySettled).toBe(false);

    gatedTranscribe.resolve({ text: "late" });
    await expect(zombieChunk).resolves.toBe("");
    await retry;
    // Retry opened its own provider session only after the lock was released.
    expect(providerMocks.local.openSession).toHaveBeenCalledTimes(2);
  });

  it("pin 3: a chunk failure during drain latches before drain unblocks; resolve rejects the exact object", async () => {
    const order: string[] = [];
    const boom = new Error("provider exploded");
    const gatedTranscribe = deferred<TranscriptionOutput>();
    providerMocks.local.setupSession("drain-session", (session) => {
      session.transcribe.mockImplementationOnce(() => gatedTranscribe.promise);
    });

    const listener = vi.fn((error: Error) => {
      order.push(`callback:${error.message}`);
    });
    expect(service.beginStreamingSession("drain-session", listener)).toBe(true);
    const chunk = processChunk("drain-session", 1);
    void chunk.catch(() => undefined);
    await settle();

    const resolve = service.resolveStreamingSession({
      sessionId: "drain-session",
    });
    const resolveOutcome = resolve.then(
      () => {
        order.push("resolved");
      },
      () => {
        order.push("rejected");
      },
    );

    gatedTranscribe.reject(boom);
    await expect(resolve).rejects.toMatchObject({
      name: "Error",
      message: boom.message,
    });
    await resolveOutcome;

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(boom);
    expect(order).toEqual(["callback:provider exploded", "rejected"]);
  });

  // Added at S1 with the token-lock swap: live-chunk VAD, retry VAD, and the
  // new-session VAD reset must all contend on ONE lock.
  it("S1 gate: live VAD, retry VAD, and VAD reset serialize on one lock in arrival order", async () => {
    const order: string[] = [];
    const vadGate = deferred<{ probability: number; isSpeaking: boolean }>();
    let firstVadCall = true;
    processVadFrame.mockImplementation(() => {
      if (firstVadCall) {
        firstVadCall = false;
        order.push("live-vad");
        return vadGate.promise;
      }
      order.push("retry-vad");
      return Promise.resolve({ probability: 1, isSpeaking: true });
    });
    vadReset.mockImplementation(() => {
      order.push("reset");
    });

    expect(service.beginStreamingSession("vad-session")).toBe(true);
    const liveChunk = processChunk("vad-session", 1);
    await settle();
    expect(order).toEqual(["live-vad"]);

    // Free the slot; the in-flight VAD call still holds the lock.
    await service.cancelStreamingSession("vad-session");

    const retry = service.retryTranscription(1);
    void retry.catch(() => undefined);
    await settle();
    const reset = service.resetVadForNewSession();
    await settle();
    // Nothing else entered the lock while the live VAD call is in flight.
    expect(order).toEqual(["live-vad"]);

    vadGate.resolve({ probability: 1, isSpeaking: true });
    await expect(liveChunk).resolves.toBe("");
    await retry;
    await reset;

    // FIFO: retry (queued first) runs its reset + frames, then the reset call.
    expect(order).toEqual(["live-vad", "reset", "retry-vad", "reset"]);
  });

  // Added at S3 (plan D12): one fiber per chunk at sustained frame rate must
  // not reorder, leak ledger entries, or block resolve.
  it("S3 gate: sustained frames keep order and drain to zero", async () => {
    const total = 2000;
    const startedAt = performance.now();
    let spanEnds = 0;
    setSpanEndSink(() => {
      spanEnds += 1;
    });
    providerMocks.local.setupSession("stress-session", (session) => {
      session.transcribe.mockImplementation(
        async (params: TranscribeParams) => ({
          text: `${params.audioData[0]},`,
        }),
      );
      session.flush.mockResolvedValue({ text: "" });
    });

    expect(service.beginStreamingSession("stress-session")).toBe(true);
    const chunks: Array<Promise<string>> = [];
    for (let i = 1; i <= total; i++) {
      chunks.push(processChunk("stress-session", i));
    }
    await Promise.all(chunks);

    const providerSession = providerMocks.local.sessions.get("stress-session")!;
    expect(providerSession.transcribe).toHaveBeenCalledTimes(total);
    const order = providerSession.transcribe.mock.calls.map(
      (call) => call[0].audioData[0],
    );
    expect(order).toEqual(Array.from({ length: total }, (_, i) => i + 1));

    // Coarse per-chunk overhead tripwire, not a benchmark: with instant
    // mocks the whole path is fiber + two lock cycles per chunk. A regression
    // that makes this quadratic or adds per-chunk I/O trips the bound; CI
    // noise does not (bound is ~10x the observed cost).
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeLessThan(total * 2.5);

    // The ledger drained: resolve completes without waiting on anything.
    const resolved = await service.resolveStreamingSession({
      sessionId: "stress-session",
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.text.split(",").filter(Boolean)).toHaveLength(total);
    // S6 gate: span emission is independent of chunk count — only the
    // resolve-stage spans fire, never per-chunk spans (plan D5/D12).
    setSpanEndSink(() => {});
    expect(spanEnds).toBeLessThanOrEqual(8);
  }, 20000);

  // Review-pass additions.
  it("review gate: a terminal chunk failure with a queued sibling leaves the lock usable", async () => {
    const boom = new Error("provider died");
    const gate = deferred<TranscriptionOutput>();
    providerMocks.local.setupSession("fail-session", (session) => {
      session.transcribe.mockImplementationOnce(() => gate.promise);
    });
    expect(service.beginStreamingSession("fail-session")).toBe(true);
    const chunkA = processChunk("fail-session", 1);
    void chunkA.catch(() => undefined);
    await settle();
    const chunkB = processChunk("fail-session", 2);
    void chunkB.catch(() => undefined);
    await settle();

    // A fails; its release hands the lock to B; the terminal classification
    // then retires the session and interrupts B in the same cascade — the
    // exact window that destroyed the token before the review fix.
    gate.reject(boom);
    await expect(chunkA).rejects.toMatchObject({
      name: "Error",
      message: boom.message,
    });
    await expect(chunkB).resolves.toBe("");

    // The lock survived: a fresh session transcribes normally.
    expect(service.beginStreamingSession("next-session")).toBe(true);
    await expect(processChunk("next-session", 3)).resolves.toContain("");
    expect(
      providerMocks.local.sessions.get("next-session")!.transcribe,
    ).toHaveBeenCalledTimes(1);
  });

  it("review gate: cancel interrupts a chunk waiting in the lock queue; its transcribe never starts", async () => {
    const gate = deferred<TranscriptionOutput>();
    providerMocks.local.setupSession("queue-session", (session) => {
      session.transcribe.mockImplementationOnce(() => gate.promise);
    });
    expect(service.beginStreamingSession("queue-session")).toBe(true);
    const chunkA = processChunk("queue-session", 1);
    await settle();
    const chunkB = processChunk("queue-session", 2);
    await settle();

    await service.cancelStreamingSession("queue-session");
    await expect(chunkB).resolves.toBe("");
    gate.resolve({ text: "late" });
    await expect(chunkA).resolves.toBe("");

    const providerSession = providerMocks.local.sessions.get("queue-session")!;
    expect(providerSession.transcribe).toHaveBeenCalledTimes(1);
    // The lock is free for the next session.
    expect(service.beginStreamingSession("after-cancel")).toBe(true);
    await expect(processChunk("after-cancel", 3)).resolves.toBeDefined();
  });

  it("review gate: a malformed VAD result degrades the chunk instead of killing the session", async () => {
    const listener = vi.fn();
    processVadFrame.mockResolvedValueOnce(
      undefined as unknown as { probability: number; isSpeaking: boolean },
    );
    expect(service.beginStreamingSession("vad-malformed", listener)).toBe(true);
    await expect(processChunk("vad-malformed", 1)).resolves.toBeDefined();
    expect(listener).not.toHaveBeenCalled();
    const providerSession = providerMocks.local.sessions.get("vad-malformed")!;
    expect(providerSession.transcribe).toHaveBeenCalledTimes(1);
    expect(providerSession.transcribe.mock.calls[0][0].speechProbability).toBe(
      1,
    );
  });
});
