import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  wedgeBudgetMs,
  type LifecycleTuning,
} from "../../src/main/lifecycle/tuning";
import { FakeTimers } from "../helpers/lifecycle-fakes";
import { AppError, ErrorCodes } from "../../src/types/error";

const db = vi.hoisted(() => ({
  createProvisionalTranscription: vi.fn(async () => ({ id: 1 })),
  enrichTranscriptionBySession: vi.fn(async () => undefined),
  stampTranscriptionDisposition: vi.fn(async () => ({ id: 1 })),
  deleteProvisionalTranscription: vi.fn(async () => null),
  getUncommittedTranscriptions: vi.fn(async () => []),
  getLatestTranscription: vi.fn(async () => null),
}));

vi.mock("../../src/db/transcriptions", () => db);
vi.mock("../../src/db/daily-stats", () => ({
  incrementDailyStats: vi.fn(async () => undefined),
}));

import {
  createRecordingLifecycle,
  type LifecycleNotification,
  type RecordingLifecycle,
} from "../../src/main/lifecycle/runtime";
import type { ResolvedStreamingSession } from "../../src/services/transcription-service";

const TUNING: LifecycleTuning = {
  stageBoundsMs: {
    starting: 11,
    recording: 22,
    resolving: 33,
    committing: 44,
    staging: 55,
  },
  deadMicMs: 5,
  drainMs: 7,
  pressWindowMs: 3,
  quickWindowMs: 4,
  longRecordingReminderMs: 99,
  commitRepairDelayMs: 66,
};

const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

function makeHarness(options?: {
  hasSpeechModelSelected?: () => Promise<boolean>;
  resolveText?: string;
  hasModel?: boolean;
  retryInProgress?: boolean;
  draftChord?: () => boolean;
}) {
  const timers = new FakeTimers();
  const pastes: string[] = [];
  const notifications: LifecycleNotification[] = [];
  const terminalCallbacks = new Map<string, (error: Error) => void>();
  const ambianceEnds: unknown[] = [];
  let mint = 0;

  const service = {
    beginStreamingSession: vi.fn(
      (sessionId: string, onTerminalFailure?: (error: Error) => void) => {
        if (onTerminalFailure)
          terminalCallbacks.set(sessionId, onTerminalFailure);
        return true;
      },
    ),
    processStreamingChunk: vi.fn(async () => ""),
    resolveStreamingSession: vi.fn(
      async (): Promise<ResolvedStreamingSession | null> => ({
        text: options?.resolveText ?? "hello world",
        language: "en",
        speechModel: "whisper-tiny",
        meta: { vocabularySize: 0 },
      }),
    ),
    cancelStreamingSession: vi.fn(async () => undefined),
    resetVadForNewSession: vi.fn(async () => undefined),
    warmupActiveProvider: vi.fn(async () => undefined),
    isHistoryRetryInProgress: vi.fn(() => options?.retryInProgress ?? false),
  };

  const lifecycle: RecordingLifecycle = createRecordingLifecycle({
    transcriptionService: service,
    ambiance: {
      begin: () => ({
        beepGate: Promise.resolve(),
        done: Promise.resolve({ systemAudioMuted: false, soundsMuted: true }),
      }),
      end: (_session, context) => ambianceEnds.push(context),
    },
    bridge: {
      pasteText: async ({ transcript }) => {
        pastes.push(transcript);
      },
      setDraftEnterCapture: async () => undefined,
    },
    getPreserveClipboard: async () => false,
    hasSpeechModelSelected:
      options?.hasSpeechModelSelected ??
      (async () => options?.hasModel ?? true),
    isDraftChordActive: options?.draftChord ?? (() => false),
    setDraftInputActive: () => undefined,
    audioFilePathFor: (session) => `/audio/${session}.wav`,
    tuning: TUNING,
    timers,
    mintSession: () => `s${++mint}`,
    createWavWriter: () => ({
      appendAudio: async () => undefined,
      finalize: async () => undefined,
      abort: async () => undefined,
    }),
  });
  lifecycle.onNotification((event) => notifications.push(event));

  const frames = (value: number) => new Float32Array(1600).fill(value);

  return {
    lifecycle,
    timers,
    pastes,
    notifications,
    service,
    terminalCallbacks,
    ambianceEnds,
    frames,
    async startToRecording(mic = "Built-in Mic") {
      lifecycle.setPttLevel(true);
      await settle();
      const session = lifecycle.getSnapshot().sessionId!;
      lifecycle.captureStarted(session, { name: mic });
      await settle();
      return session;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recording lifecycle runtime", () => {
  it("PTT hold-release delivers: record → resolve → commit → paste → idle", async () => {
    const h = makeHarness();
    const session = await h.startToRecording();
    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("recording");
    expect(h.service.beginStreamingSession).toHaveBeenCalledWith(
      session,
      expect.any(Function),
    );

    h.timers.fire(TUNING.pressWindowMs); // held past the press window
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), false);
    await settle();
    expect(db.createProvisionalTranscription).toHaveBeenCalledWith({
      sessionId: session,
      audioFile: `/audio/${session}.wav`,
    });

    h.lifecycle.setPttLevel(false);
    await settle();
    expect(h.lifecycle.getSnapshot().projection).toMatchObject({
      publicState: "stopping",
      stopKind: "finalize",
      stopOrigin: "user",
    });

    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), true);
    await settle();

    expect(db.stampTranscriptionDisposition).toHaveBeenCalledWith(session, {
      disposition: "success",
      text: "hello world",
    });
    expect(h.pastes).toEqual(["hello world"]);
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      sessionId: null,
      projection: { publicState: "idle" },
    });
    expect(h.ambianceEnds).toHaveLength(1);
    expect(h.timers.armedDurations()).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it("a quick tap cancels: discard, no transcription result, no paste", async () => {
    const h = makeHarness();
    const session = await h.startToRecording();
    h.lifecycle.setPttLevel(false); // inside the press window: quick release
    await settle();
    h.timers.fire(TUNING.quickWindowMs); // no re-press: tap becomes a discard
    await settle();

    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(db.stampTranscriptionDisposition).not.toHaveBeenCalled();
    expect(db.deleteProvisionalTranscription).toHaveBeenCalledWith(session);
    expect(h.service.cancelStreamingSession).toHaveBeenCalledWith(session);
    expect(h.pastes).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it("tap-to-latch upgrades the session to hands-free and keeps recording", async () => {
    const h = makeHarness();
    await h.startToRecording();
    h.lifecycle.setPttLevel(false);
    h.lifecycle.setPttLevel(true); // re-press inside the quick window
    await settle();

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      projection: { publicState: "recording" },
      metadata: { mode: "hands-free" },
    });

    h.lifecycle.setPttLevel(false); // releasing the latch press: still recording
    await settle();
    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("recording");

    h.lifecycle.setPttLevel(true); // next press stops
    await settle();
    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("stopping");
  });

  it("a latch upgrade during a slow admission gate still lands", async () => {
    let releaseGate!: (value: boolean) => void;
    const h = makeHarness({
      hasSpeechModelSelected: () =>
        new Promise<boolean>((resolve) => {
          releaseGate = resolve;
        }),
    });

    // Tap and re-press while the model lookup is still pending: the
    // upgrade queues behind the admission instead of hitting IDLE.
    h.lifecycle.setPttLevel(true);
    h.lifecycle.setPttLevel(false);
    h.lifecycle.setPttLevel(true);
    await settle();
    expect(h.lifecycle.getSnapshot().sessionId).toBeNull();

    releaseGate(true);
    await settle();

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      projection: { publicState: "starting" },
      metadata: { mode: "hands-free" },
    });
  });

  it("a hung admission gate refuses the start instead of blocking input", async () => {
    const h = makeHarness({
      hasSpeechModelSelected: () => new Promise<boolean>(() => undefined),
    });

    h.lifecycle.setPttLevel(true);
    await settle();
    h.timers.fire(3_000); // admission gate bound
    await settle();

    expect(h.lifecycle.getSnapshot().sessionId).toBeNull();
    expect(h.notifications).toEqual([
      expect.objectContaining({
        type: "transcription_failed",
        errorCode: ErrorCodes.UNKNOWN,
      }),
    ]);
  });

  it("a dead mic seals discard(no_audio) and notifies with the microphone", async () => {
    const h = makeHarness();
    await h.startToRecording("Rode NT");
    h.timers.fire(TUNING.deadMicMs);
    await settle();

    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(h.notifications).toEqual([
      { type: "no_audio", params: { microphone: "Rode NT" } },
    ]);
    expect(db.deleteProvisionalTranscription).toHaveBeenCalled();
  });

  it("draft sessions stage for review; Enter confirms and pastes", async () => {
    const h2 = makeHarness({ draftChord: () => true });
    const s2 = await h2.startToRecording();
    h2.timers.fire(TUNING.pressWindowMs);
    await h2.lifecycle.handleAudioChunk(s2, h2.frames(0.5), false);
    h2.lifecycle.setPttLevel(false);
    await settle();
    await h2.lifecycle.handleAudioChunk(s2, h2.frames(0.5), true);
    await settle();

    expect(h2.pastes).toEqual([]);
    expect(h2.lifecycle.getPendingDraft()).toEqual({
      sessionId: s2,
      text: "hello world",
    });
    expect(h2.lifecycle.getSnapshot().projection.publicState).toBe("idle");

    await h2.lifecycle.confirmDraftFromInput();
    await settle();
    expect(h2.pastes).toEqual(["hello world"]);
    expect(h2.lifecycle.getPendingDraft()).toBeNull();
  });

  it("admission gates: missing model and active history retry refuse with a toast", async () => {
    const noModel = makeHarness({ hasModel: false });
    await noModel.lifecycle.startDictation("hands-free");
    expect(noModel.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(noModel.notifications).toEqual([
      { type: "transcription_failed", errorCode: ErrorCodes.MODEL_MISSING },
    ]);
    expect(noModel.service.beginStreamingSession).not.toHaveBeenCalled();

    const retrying = makeHarness({ retryInProgress: true });
    await retrying.lifecycle.startDictation("hands-free");
    expect(retrying.notifications).toEqual([
      { type: "transcription_failed", errorCode: ErrorCodes.RETRY_IN_PROGRESS },
    ]);
  });

  it("a release racing the admission still stops the session (verb order)", async () => {
    const h = makeHarness();
    h.lifecycle.setPttLevel(true);
    h.timers.fire(TUNING.pressWindowMs);
    h.lifecycle.setPttLevel(false); // stop queued behind the async admission
    await settle();

    // The session was admitted, then immediately stopped from STARTING:
    // sealed as discard(interrupted_start), settled back to idle.
    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(db.deleteProvisionalTranscription).toHaveBeenCalled();
    expect(h.service.beginStreamingSession).toHaveBeenCalledTimes(1);
  });

  it("an uncommanded terminal failure mid-recording seals and toasts with detail", async () => {
    const h = makeHarness();
    const session = await h.startToRecording();
    h.terminalCallbacks.get(session)!(
      new AppError("cloud down", ErrorCodes.NETWORK_ERROR, {
        uiMessage: "Service unreachable",
      }),
    );
    await settle();

    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(h.notifications).toEqual([
      expect.objectContaining({
        type: "transcription_failed",
        errorCode: ErrorCodes.NETWORK_ERROR,
        uiMessage: "Service unreachable",
      }),
    ]);
    // Failure keeps the record: stamped, not deleted.
    expect(db.stampTranscriptionDisposition).toHaveBeenCalledWith(session, {
      disposition: "failure",
      metaPatch: { failureReason: ErrorCodes.NETWORK_ERROR },
    });
  });

  it("a hung resolve seals failure(timeout) and surfaces it", async () => {
    const h = makeHarness();
    h.service.resolveStreamingSession.mockImplementation(
      () => new Promise(() => undefined),
    );
    const session = await h.startToRecording();
    h.timers.fire(TUNING.pressWindowMs);
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), false);
    h.lifecycle.setPttLevel(false);
    await settle();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), true);
    await settle();
    h.timers.fire(TUNING.stageBoundsMs.resolving);
    await settle();

    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    // Never a silent reset (R3): the timeout failure surfaces like any
    // other failure seal; the surface renders unknown causes generically.
    expect(h.notifications).toEqual([
      expect.objectContaining({
        type: "transcription_failed",
        errorCode: "timeout",
      }),
    ]);
    expect(db.stampTranscriptionDisposition).toHaveBeenCalledWith(session, {
      disposition: "failure",
      metaPatch: { failureReason: "timeout" },
    });
  });

  it("empty transcripts toast unconditionally on the empty seal", async () => {
    const h = makeHarness({ resolveText: "" });
    const session = await h.startToRecording("Blue Yeti");
    h.timers.fire(TUNING.pressWindowMs);
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), false);
    h.lifecycle.setPttLevel(false);
    await settle();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), true);
    await settle();

    expect(db.stampTranscriptionDisposition).toHaveBeenCalledWith(session, {
      disposition: "empty",
    });
    expect(h.pastes).toEqual([]);
    expect(h.notifications).toEqual([
      { type: "empty_transcript", params: { microphone: "Blue Yeti" } },
    ]);
  });

  it("auto-stop at the cap is visible and notifies", async () => {
    const h = makeHarness();
    const session = await h.startToRecording();
    h.timers.fire(TUNING.pressWindowMs);
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), false);
    h.timers.fire(TUNING.stageBoundsMs.recording);
    await settle();

    expect(h.lifecycle.getSnapshot().projection).toMatchObject({
      publicState: "stopping",
      stopOrigin: "auto",
    });
    expect(h.notifications).toEqual([{ type: "recording_auto_stopped" }]);
  });

  it("the long-recording reminder fires off the recording projection", async () => {
    const h = makeHarness();
    await h.startToRecording();
    h.timers.fire(TUNING.longRecordingReminderMs);
    expect(h.notifications).toEqual([
      expect.objectContaining({
        type: "recording_duration_warning",
        params: {
          minutes: expect.any(Number),
          maxMinutes: expect.any(Number),
        },
      }),
    ]);
  });

  it("ESC dismisses the pending draft first, then live sessions", async () => {
    const h = makeHarness({ draftChord: () => true });
    const session = await h.startToRecording();
    h.timers.fire(TUNING.pressWindowMs);
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), false);
    h.lifecycle.setPttLevel(false);
    await settle();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), true);
    await settle();
    expect(h.lifecycle.getPendingDraft()).not.toBeNull();

    await h.lifecycle.dismiss();
    expect(h.lifecycle.getPendingDraft()).toBeNull();

    // No draft pending: ESC dismisses the live session.
    const h2 = makeHarness();
    const s2 = await h2.startToRecording();
    await h2.lifecycle.dismiss();
    await settle();
    expect(h2.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(h2.service.cancelStreamingSession).toHaveBeenCalledWith(s2);
    expect(db.stampTranscriptionDisposition).toHaveBeenCalledWith(s2, {
      disposition: "dismissed",
    });
  });

  it("the wedge watchdog force-resets a session that outlives its budget", async () => {
    const h = makeHarness();
    const session = await h.startToRecording();
    // Simulate a wedged stack: fire only the watchdog (stage bounds never ran).
    h.timers.fire(wedgeBudgetMs(TUNING));
    await settle();

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      sessionId: null,
      projection: { publicState: "idle" },
    });
    // R10 teardown: ports were told to abandon the wedged session. The
    // recorder drains best-effort; its bound closes custody with no session
    // left to notify (the late recorderClosed is a fenced no-op).
    expect(h.service.cancelStreamingSession).toHaveBeenCalledWith(session);
    expect(h.timers.armedDurations()).toEqual([TUNING.drainMs]);
    h.timers.fire(TUNING.drainMs);
    await settle();
    expect(h.timers.armedDurations()).toEqual([]);
    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
  });
});
