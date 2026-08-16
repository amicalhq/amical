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
  emptyNoticeMinRecordingMs: 8,
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
    h.timers.fire(TUNING.drainMs); // no final chunk: custody closes at the bound
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

    h.timers.fire(TUNING.pressWindowMs); // the start window expires
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
    h.timers.fire(TUNING.drainMs); // no final chunk: custody closes at the bound
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
    await noModel.lifecycle.startDictation();
    await settle();
    expect(noModel.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(noModel.notifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.MODEL_MISSING,
        noRecording: true,
      },
    ]);
    expect(noModel.service.beginStreamingSession).not.toHaveBeenCalled();

    const retrying = makeHarness({ retryInProgress: true });
    await retrying.lifecycle.startDictation();
    await settle();
    expect(retrying.notifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.RETRY_IN_PROGRESS,
        noRecording: true,
      },
    ]);
  });

  it("a refused start resets the grammar: the next press starts", async () => {
    let hasModel = false;
    const h = makeHarness({
      hasSpeechModelSelected: async () => hasModel,
    });

    h.lifecycle.toggleKey();
    await settle();
    expect(h.lifecycle.getSnapshot().sessionId).toBeNull();
    expect(h.notifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.MODEL_MISSING,
        noRecording: true,
      },
    ]);

    // The refusal must not strand the grammar latched — the very next
    // toggle starts instead of being swallowed as a no-op stop.
    hasModel = true;
    h.lifecycle.toggleKey();
    await settle();
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      projection: { publicState: "starting" },
      metadata: { mode: "hands-free" },
    });
  });

  it("a surface start is grammar-driven: a PTT tap stops it, never discards", async () => {
    const h = makeHarness();
    await h.lifecycle.startDictation();
    await settle();
    h.lifecycle.captureStarted(h.lifecycle.getSnapshot().sessionId!, {});
    await settle();
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      projection: { publicState: "recording" },
      metadata: { mode: "hands-free" },
    });
    h.timers.fire(TUNING.pressWindowMs); // the start window expires

    // The regression: a stray PTT tap used to run its own idle→window path
    // and quick-discard the live session. Grammar-driven starts make the
    // press a normal stop.
    h.lifecycle.setPttLevel(true);
    await settle();
    expect(h.lifecycle.getSnapshot().projection).toMatchObject({
      publicState: "stopping",
      stopKind: "finalize",
    });
  });

  it("PTT upgrades to hands-free on the toggle chord", async () => {
    const h = makeHarness();
    const session = await h.startToRecording();
    expect(h.lifecycle.getSnapshot().metadata?.mode).toBe("ptt");

    h.lifecycle.toggleKey();
    await settle();
    expect(h.lifecycle.getSnapshot().metadata?.mode).toBe("hands-free");

    // Releasing the PTT chord no longer stops: the session is latched.
    h.lifecycle.setPttLevel(false);
    await settle();
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      sessionId: session,
      projection: { publicState: "recording" },
    });
  });

  it("a quick second toggle discards; a later one stops", async () => {
    const quick = makeHarness();
    quick.lifecycle.toggleKey();
    await settle();
    quick.lifecycle.toggleKey(); // inside the quick window: accident
    await settle();
    // Discarded, never stamped — the accidental session leaves no trace.
    expect(quick.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(db.stampTranscriptionDisposition).not.toHaveBeenCalled();
    expect(quick.notifications).toEqual([]);

    const slow = makeHarness();
    slow.lifecycle.toggleKey();
    await settle();
    slow.lifecycle.captureStarted(slow.lifecycle.getSnapshot().sessionId!, {});
    await settle();
    slow.timers.fire(TUNING.pressWindowMs); // the start window expires
    slow.lifecycle.toggleKey();
    await settle();
    expect(slow.lifecycle.getSnapshot().projection.stopKind).toBe("finalize");
  });

  it("toggle inputs are dropped while a draft is pending or live", async () => {
    const h = makeHarness({ draftChord: () => true });
    const session = await h.startToRecording();
    h.timers.fire(TUNING.pressWindowMs);
    await h.lifecycle.handleAudioChunk(session, h.frames(0.5), false);
    await settle();
    expect(h.lifecycle.getSnapshot().metadata?.isDraft).toBe(true);

    // Draft is push-to-talk only: no hands-free upgrade of a live draft.
    h.lifecycle.toggleKey();
    await settle();
    expect(h.lifecycle.getSnapshot().metadata?.mode).toBe("ptt");
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
    h.timers.fire(TUNING.drainMs); // no final chunk: custody closes at the bound
    await settle();

    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
    expect(h.notifications).toEqual([
      expect.objectContaining({
        type: "transcription_failed",
        errorCode: ErrorCodes.NETWORK_ERROR,
        uiMessage: "Service unreachable",
        // The recording ran, so the saved-recording sub-line stays truthful.
        noRecording: false,
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

  it("empty transcripts toast only past the duration gate (D24)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });

    // Short recording: sealed empty, but the notice stays silent.
    const short = makeHarness({ resolveText: "" });
    const shortSession = await short.startToRecording("Blue Yeti");
    short.timers.fire(TUNING.pressWindowMs);
    await short.lifecycle.handleAudioChunk(
      shortSession,
      short.frames(0.5),
      false,
    );
    vi.setSystemTime(Date.now() + TUNING.emptyNoticeMinRecordingMs);
    short.lifecycle.setPttLevel(false);
    await settle();
    await short.lifecycle.handleAudioChunk(
      shortSession,
      short.frames(0.5),
      true,
    );
    await settle();
    expect(db.stampTranscriptionDisposition).toHaveBeenCalledWith(
      shortSession,
      { disposition: "empty" },
    );
    expect(short.notifications).toEqual([]);

    // Long recording: the notice fires.
    const long = makeHarness({ resolveText: "" });
    const longSession = await long.startToRecording("Blue Yeti");
    long.timers.fire(TUNING.pressWindowMs);
    await long.lifecycle.handleAudioChunk(longSession, long.frames(0.5), false);
    vi.setSystemTime(Date.now() + TUNING.emptyNoticeMinRecordingMs + 1);
    long.lifecycle.setPttLevel(false);
    await settle();
    await long.lifecycle.handleAudioChunk(longSession, long.frames(0.5), true);
    await settle();
    expect(long.pastes).toEqual([]);
    expect(long.notifications).toEqual([
      { type: "empty_transcript", params: { microphone: "Blue Yeti" } },
    ]);
  });

  it("a retry admitted during the gate await refuses with the truthful reason", async () => {
    let releaseGate!: (value: boolean) => void;
    const h = makeHarness({
      hasSpeechModelSelected: () =>
        new Promise<boolean>((resolve) => {
          releaseGate = resolve;
        }),
    });

    h.lifecycle.toggleKey();
    await settle();
    // A history retry wins the engines while the model lookup is pending.
    h.service.isHistoryRetryInProgress.mockReturnValue(true);
    releaseGate(true);
    await settle();

    expect(h.lifecycle.getSnapshot().sessionId).toBeNull();
    expect(h.service.beginStreamingSession).not.toHaveBeenCalled();
    expect(h.notifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.RETRY_IN_PROGRESS,
        noRecording: true,
      },
    ]);

    // Grammar was reset by the refusal: the next toggle starts normally.
    h.service.isHistoryRetryInProgress.mockReturnValue(false);
    h.lifecycle.toggleKey();
    await settle();
    releaseGate(true);
    await settle();
    expect(h.lifecycle.getSnapshot().projection.publicState).toBe("starting");
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
    h2.timers.fire(TUNING.drainMs); // no final chunk: custody closes at the bound
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
