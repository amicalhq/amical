import { describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import type { GetAccessibilityContextResult } from "@amical/types";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const db = vi.hoisted(() => ({
  createProvisionalTranscription: vi.fn(async () => ({ id: 1 })),
  enrichTranscriptionBySession: vi.fn(async () => undefined),
  stampTranscriptionDisposition: vi.fn(async () => ({ id: 1 })),
  deleteProvisionalTranscription: vi.fn(async () => null),
  getUncommittedTranscriptions: vi.fn(async () => []),
  getLatestTranscription: vi.fn(async () => null),
}));

vi.mock("../../src/db/transcriptions", () => db);
import {
  createDesktopRecordingLifecycle,
  RecordingLifecycleLive,
} from "../../src/main/lifecycle/live";
import {
  AppScopeTag,
  ModelServiceTag,
  NativeBridgeTag,
  RecordingLifecycleTag,
  RemoteConfigServiceTag,
  SettingsServiceTag,
  TranscriptionServiceTag,
  WindowManagerTag,
} from "../../src/main/runtime/tags";
import {
  installDictationTrace,
  settleObligation,
  _resetDictationTraceForTests,
} from "../../src/main/telemetry/dictation-trace";
import type { NativeBridge } from "../../src/services/platform/native-bridge-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { ModelService } from "../../src/services/model-service";
import type { TranscriptionService } from "../../src/services/transcription-service";
import type { ShellTimerHost } from "../../src/main/lifecycle/shell";

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

const AX_CONTEXT: GetAccessibilityContextResult = {
  context: {
    textSelection: null,
  },
} as unknown as GetAccessibilityContextResult;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Characterization harness for the desktop binding: beep-gate resilience,
 * ambiance end-joins-begin, the draft copy-capture barrier, and its
 * once-per-session latch. This is permanent regression coverage.
 */
function makeLive(options?: {
  preferences?: () => Promise<{
    muteDictationSounds: boolean;
    muteSystemAudio: boolean;
    preserveClipboard: boolean;
  }>;
  startRecording?: () => Promise<{
    success: boolean;
  }>;
  startGateTimers?: ShellTimerHost;
  withoutNativeBridge?: boolean;
  selectedTextViaCopy?: () => Promise<{
    selectedText: string | null;
    clipboardChanged: boolean;
  }>;
  draftChord?: boolean;
}) {
  const nativeCalls: Array<{ method: string; params: unknown }> = [];
  const chunks: Array<{ session: string; final: boolean }> = [];
  let resolveCalls = 0;
  let resolveGate: (() => void) | null = null;

  const nativeBridge = {
    call: vi.fn(async (method: string, params: unknown) => {
      nativeCalls.push({ method, params });
      if (method === "startRecording") {
        return options?.startRecording
          ? await options.startRecording()
          : { success: true };
      }
      return { success: true };
    }),
    setDraftEnterCapture: vi.fn(async () => undefined),
    refreshAccessibilityContext: vi.fn(async () => undefined),
    getAccessibilityContext: vi.fn(() => AX_CONTEXT),
    getSelectedTextViaCopy: vi.fn(async () =>
      options?.selectedTextViaCopy
        ? await options.selectedTextViaCopy()
        : { selectedText: null, clipboardChanged: false },
    ),
  } as unknown as NativeBridge;

  const settingsService = {
    getPreferences:
      options?.preferences ??
      (async () => ({
        muteDictationSounds: false,
        muteSystemAudio: false,
        preserveClipboard: true,
      })),
  } as unknown as SettingsService;

  const modelService = {
    getSelectedModel: async () => "whisper-tiny",
  } as unknown as ModelService;

  const transcriptionService = {
    beginStreamingSession: vi.fn(() => true),
    processStreamingChunk: vi.fn(
      async (opts: { sessionId: string; audioChunk: Float32Array }) => {
        chunks.push({ session: opts.sessionId, final: false });
        return "";
      },
    ),
    resolveStreamingSession: vi.fn(async () => {
      resolveCalls += 1;
      if (resolveGate) {
        await new Promise<void>((resolve) => {
          resolveGate = null;
          resolve();
        });
      }
      return {
        text: "captured words",
        language: "en",
        speechModel: "whisper-tiny",
        meta: { vocabularySize: 0 },
      };
    }),
    cancelStreamingSession: vi.fn(async () => undefined),
    resetVadForNewSession: vi.fn(async () => undefined),
    warmupActiveProvider: vi.fn(async () => undefined),
    isHistoryRetryInProgress: vi.fn(() => false),
    updateStreamingSession: vi.fn(async () => undefined),
  } as unknown as TranscriptionService;

  const lifecycle = createDesktopRecordingLifecycle({
    transcriptionService,
    nativeBridge: options?.withoutNativeBridge ? null : nativeBridge,
    settingsService,
    modelService,
    startGateTimers: options?.startGateTimers,
  });

  if (options?.draftChord) {
    lifecycle.bindShortcutManager({
      on: () => undefined,
      isPTTDraftActive: () => true,
      setDraftActive: () => undefined,
    } as never);
  }

  const frames = (value: number) => new Float32Array(1600).fill(value);

  return {
    lifecycle,
    nativeBridge,
    nativeCalls,
    chunks,
    frames,
    transcriptionService,
    resolveCallCount: () => resolveCalls,
    async startToRecording() {
      await lifecycle.startDictation();
      await settle();
      const session = lifecycle.getSnapshot().sessionId!;
      expect(session).toBeTruthy();
      lifecycle.captureStarted(session, { name: "Mic" });
      await settle();
      return session;
    },
    async finishSession(session: string) {
      await lifecycle.stopDictation();
      await settle();
      await lifecycle.handleAudioChunk(session, frames(0.4), true);
      await settle();
    },
  };
}

describe("desktop live binding", () => {
  it("measures native RPCs in main using unchanged native responses", async () => {
    _resetDictationTraceForTests();
    const flushed: Record<string, unknown>[] = [];
    installDictationTrace({
      trackDictationTrace: (payload) => {
        flushed.push(payload);
      },
    });
    try {
      const h = makeLive({
        startRecording: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { success: true };
        },
      });
      const session = await h.startToRecording();
      await h.finishSession(session);
      await settle(10);
      expect(h.lifecycle.getSnapshot().projection.publicState).toBe("idle");
      settleObligation(session, "capture.timings");
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toMatchObject({
        native_start_recording_rpc_duration_ms: expect.any(Number),
        native_start_recording_rpc_start_offset_ms: expect.any(Number),
        native_stop_recording_rpc_duration_ms: expect.any(Number),
        native_stop_recording_rpc_start_offset_ms: expect.any(Number),
      });
      const spans = flushed[0].trace_spans as {
        name: string;
        process: string;
      }[];
      expect(
        spans
          .filter((span) => span.name.startsWith("native."))
          .map((span) => ({ name: span.name, process: span.process })),
      ).toEqual([
        { name: "native.start-recording.rpc", process: "main" },
        { name: "native.stop-recording.rpc", process: "main" },
      ]);
    } finally {
      _resetDictationTraceForTests();
    }
  });

  it("validates channel metadata at IPC without dropping valid audio", async () => {
    const scope = Effect.runSync(Scope.make());
    try {
      const ctx = await Effect.runPromise(
        Layer.build(
          RecordingLifecycleLive.pipe(
            Layer.provide(Layer.succeed(AppScopeTag, scope)),
            Layer.provide(
              Layer.succeed(SettingsServiceTag, {} as SettingsService),
            ),
            Layer.provide(Layer.succeed(ModelServiceTag, {} as ModelService)),
            Layer.provide(Layer.succeed(NativeBridgeTag, null)),
            Layer.provide(Layer.succeed(TranscriptionServiceTag, null)),
            Layer.provide(Layer.succeed(RemoteConfigServiceTag, {} as never)),
            Layer.provide(Layer.succeed(WindowManagerTag, {} as never)),
          ),
        ).pipe(Scope.provide(scope)),
      );
      const lifecycle = Context.get(ctx, RecordingLifecycleTag);
      const forward = vi
        .spyOn(lifecycle, "handleAudioChunk")
        .mockResolvedValue();
      const handler = vi
        .mocked(ipcMain.handle)
        .mock.calls.find(([channel]) => channel === "audio-data-chunk")![1];
      const pcm = new Float32Array([0.25, -0.5]);
      const valid = {
        inputChannelCount: 2,
        trackChannelCount: 2,
        stereoDownmixEnabled: false,
      };
      for (const [metadata, expected] of [
        [{ ...valid, deviceId: "must-not-leak" }, valid],
        [{ ...valid, inputChannelCount: 0 }, undefined],
        [{ ...valid, stereoDownmixEnabled: "false" }, undefined],
        [undefined, undefined],
      ]) {
        await handler(
          {} as Electron.IpcMainInvokeEvent,
          "session-1",
          pcm.buffer,
          true,
          metadata,
        );
        expect(forward).toHaveBeenLastCalledWith(
          "session-1",
          pcm,
          true,
          expected,
        );
      }
      expect(forward).toHaveBeenCalledTimes(4);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("a rejected preferences read still releases the beep gate", async () => {
    const h = makeLive({
      preferences: async () => {
        throw new Error("settings store down");
      },
    });
    const session = await h.startToRecording();
    // The gate must have released despite the rejection: a non-final frame
    // reaches the stream instead of being dropped forever.
    await h.lifecycle.handleAudioChunk(session, h.frames(0.4), false);
    await settle();
    expect(h.chunks).toEqual([{ session, final: false }]);
    await h.finishSession(session);
  });

  it.each([true, false])(
    "releases the beep gate on native start completion (success: %s)",
    async (success) => {
      const timers = new FakeTimers();
      const h = makeLive({
        startGateTimers: timers,
        startRecording: async () => ({ success }),
      });
      const session = await h.startToRecording();

      expect(timers.armedDurations()).toEqual([]);
      await h.lifecycle.handleAudioChunk(session, h.frames(0.4), false);
      expect(h.chunks).toEqual([{ session, final: false }]);
      await h.finishSession(session);
    },
  );

  it("starts the 200 ms gate bound only after preferences and RPC dispatch", async () => {
    const timers = new FakeTimers();
    const preferences = deferred<{
      muteDictationSounds: boolean;
      muteSystemAudio: boolean;
      preserveClipboard: boolean;
    }>();
    const start = deferred<{ success: boolean }>();
    const h = makeLive({
      startGateTimers: timers,
      preferences: () => preferences.promise,
      startRecording: () => start.promise,
    });

    const starting = h.lifecycle.startDictation();
    await settle();
    const session = h.lifecycle.getSnapshot().sessionId!;
    h.lifecycle.captureStarted(session, { name: "Mic" });
    await settle();
    expect(
      h.nativeCalls.filter((call) => call.method === "startRecording"),
    ).toHaveLength(0);
    expect(timers.armedDurations()).toEqual([]);

    preferences.resolve({
      muteDictationSounds: false,
      muteSystemAudio: false,
      preserveClipboard: true,
    });
    await starting;
    await settle();
    expect(
      h.nativeCalls.filter((call) => call.method === "startRecording"),
    ).toHaveLength(1);
    expect(timers.armedDurations()).toEqual([200]);

    start.resolve({ success: true });
    await settle();
    expect(timers.armedDurations()).toEqual([]);
    await h.finishSession(session);
  });

  it("does not arm a gate after stop while preferences are pending", async () => {
    const timers = new FakeTimers();
    const preferences = deferred<{
      muteDictationSounds: boolean;
      muteSystemAudio: boolean;
      preserveClipboard: boolean;
    }>();
    const start = deferred<{ success: boolean }>();
    const h = makeLive({
      startGateTimers: timers,
      preferences: () => preferences.promise,
      startRecording: () => start.promise,
    });

    const starting = h.lifecycle.startDictation();
    await settle();
    const session = h.lifecycle.getSnapshot().sessionId!;
    h.lifecycle.captureStarted(session, { name: "Mic" });
    await settle();
    await h.finishSession(session);

    preferences.resolve({
      muteDictationSounds: false,
      muteSystemAudio: true,
      preserveClipboard: true,
    });
    await starting;
    await settle();
    expect(timers.armedDurations()).toEqual([]);
    expect(
      h.nativeCalls.filter((call) => call.method === "startRecording"),
    ).toHaveLength(1);
    expect(
      h.nativeCalls.filter((call) => call.method === "stopRecording"),
    ).toEqual([]);

    start.resolve({ success: true });
    await settle();
    expect(
      h.nativeCalls.filter((call) => call.method === "stopRecording"),
    ).toEqual([
      {
        method: "stopRecording",
        params: { wasMuted: true, muteSounds: false },
      },
    ]);
  });

  it("opens immediately for muted sounds and for a missing native bridge", async () => {
    const mutedTimers = new FakeTimers();
    const mutedStart = deferred<{ success: boolean }>();
    const muted = makeLive({
      startGateTimers: mutedTimers,
      preferences: async () => ({
        muteDictationSounds: true,
        muteSystemAudio: false,
        preserveClipboard: true,
      }),
      startRecording: () => mutedStart.promise,
    });
    const mutedSession = await muted.startToRecording();
    expect(mutedTimers.armedDurations()).toEqual([]);
    await muted.lifecycle.handleAudioChunk(
      mutedSession,
      muted.frames(0.4),
      false,
    );
    expect(muted.chunks).toEqual([{ session: mutedSession, final: false }]);
    await muted.lifecycle.stopDictation();
    await muted.lifecycle.handleAudioChunk(
      mutedSession,
      muted.frames(0.4),
      true,
    );
    mutedStart.resolve({ success: true });
    await settle();

    const noBridgeTimers = new FakeTimers();
    const noBridgePreferences = deferred<{
      muteDictationSounds: boolean;
      muteSystemAudio: boolean;
      preserveClipboard: boolean;
    }>();
    const noBridge = makeLive({
      startGateTimers: noBridgeTimers,
      preferences: () => noBridgePreferences.promise,
      withoutNativeBridge: true,
    });
    const noBridgeStarting = noBridge.lifecycle.startDictation();
    await settle();
    const noBridgeSession = noBridge.lifecycle.getSnapshot().sessionId!;
    noBridge.lifecycle.captureStarted(noBridgeSession, { name: "Mic" });
    await settle();
    expect(noBridgeTimers.armedDurations()).toEqual([]);
    await noBridge.lifecycle.handleAudioChunk(
      noBridgeSession,
      noBridge.frames(0.4),
      false,
    );
    expect(noBridge.chunks).toEqual([
      { session: noBridgeSession, final: false },
    ]);
    noBridgePreferences.resolve({
      muteDictationSounds: false,
      muteSystemAudio: false,
      preserveClipboard: true,
    });
    await noBridgeStarting;
    await settle();
    await noBridge.finishSession(noBridgeSession);
  });

  it("keeps gate timers session-scoped and joins late mute results", async () => {
    const timers = new FakeTimers();
    const starts = [
      deferred<{ success: boolean }>(),
      deferred<{ success: boolean }>(),
    ];
    let startIndex = 0;
    const h = makeLive({
      startGateTimers: timers,
      preferences: async () => ({
        muteDictationSounds: false,
        muteSystemAudio: true,
        preserveClipboard: true,
      }),
      startRecording: () => starts[startIndex++].promise,
    });
    const firstSession = await h.startToRecording();
    expect(timers.armedDurations()).toEqual([200]);

    await h.lifecycle.stopDictation();
    expect(timers.armedDurations()).toEqual([]);
    await h.lifecycle.handleAudioChunk(firstSession, h.frames(0.4), false);
    expect(h.chunks).toEqual([]);
    await h.lifecycle.handleAudioChunk(firstSession, h.frames(0.4), true);
    await settle();
    expect(
      h.nativeCalls.filter((call) => call.method === "stopRecording"),
    ).toEqual([]);

    const secondSession = await h.startToRecording();
    expect(secondSession).not.toBe(firstSession);
    expect(timers.armedDurations()).toEqual([200]);
    await h.lifecycle.handleAudioChunk(secondSession, h.frames(0.4), false);
    expect(h.chunks).toEqual([{ session: firstSession, final: false }]);
    timers.fire(200);
    await settle();
    await h.lifecycle.handleAudioChunk(secondSession, h.frames(0.4), false);
    expect(h.chunks).toContainEqual({ session: secondSession, final: false });

    await h.lifecycle.stopDictation();
    await h.lifecycle.handleAudioChunk(secondSession, h.frames(0.4), true);
    await settle();
    expect(
      h.nativeCalls.filter((call) => call.method === "stopRecording"),
    ).toEqual([]);

    starts[0].resolve({ success: true });
    starts[1].resolve({ success: true });
    await settle();
    expect(h.nativeCalls.filter((c) => c.method === "stopRecording")).toEqual([
      {
        method: "stopRecording",
        params: { wasMuted: true, muteSounds: false },
      },
      {
        method: "stopRecording",
        params: { wasMuted: true, muteSounds: false },
      },
    ]);
  });

  it("draft resolve waits behind the copy-capture barrier", async () => {
    const copy = deferred<{ selectedText: string; clipboardChanged: true }>();
    const h = makeLive({
      draftChord: true,
      selectedTextViaCopy: () => copy.promise,
    });
    const session = await h.startToRecording();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.4), false);
    await h.lifecycle.stopDictation();
    await settle();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.4), true);
    await settle();
    // The copy RPC is still pending: resolve must not have run.
    expect(h.resolveCallCount()).toBe(0);

    copy.resolve({ selectedText: "picked text", clipboardChanged: true });
    await settle();
    expect(h.resolveCallCount()).toBe(1);
  });

  it("the copy capture fires once per session across stopping snapshots", async () => {
    const h = makeLive({ draftChord: true });
    const session = await h.startToRecording();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.4), false);
    await h.lifecycle.stopDictation();
    await settle();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.4), true);
    await settle();
    expect(
      vi.mocked(h.nativeBridge.getSelectedTextViaCopy).mock.calls.length,
    ).toBe(1);
  });
});
