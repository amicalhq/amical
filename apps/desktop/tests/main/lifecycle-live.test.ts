import { describe, expect, it, vi } from "vitest";
import type { GetAccessibilityContextResult } from "@amical/types";

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

import { createDesktopRecordingLifecycle } from "../../src/main/lifecycle/live";
import type { NativeBridge } from "../../src/services/platform/native-bridge-service";
import type { SettingsService } from "../../src/services/settings-service";
import type { ModelService } from "../../src/services/model-service";
import type { TranscriptionService } from "../../src/services/transcription-service";

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
  startRecording?: () => Promise<{ success: boolean }>;
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
    nativeBridge,
    settingsService,
    modelService,
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

  it("a stop landing before the native start resolves still unmutes truthfully", async () => {
    const start = deferred<{ success: boolean }>();
    const h = makeLive({
      preferences: async () => ({
        muteDictationSounds: false,
        muteSystemAudio: true,
        preserveClipboard: true,
      }),
      startRecording: () => start.promise,
    });
    const session = await h.startToRecording();
    // Stop while startRecording is still pending.
    await h.lifecycle.stopDictation();
    await h.lifecycle.handleAudioChunk(session, h.frames(0.4), true);
    await settle();
    expect(h.nativeCalls.filter((c) => c.method === "stopRecording")).toEqual(
      [],
    );

    // The delayed start grants the mute: end() must join the pending begin
    // and report wasMuted truthfully instead of guessing false.
    start.resolve({ success: true });
    await settle();
    expect(h.nativeCalls.filter((c) => c.method === "stopRecording")).toEqual([
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
