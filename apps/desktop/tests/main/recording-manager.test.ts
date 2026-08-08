import { describe, expect, it, vi } from "vitest";
import { RecordingManager } from "../../src/main/managers/recording-manager";
import { RecordingMachineInterpreter } from "../../src/main/managers/recording-machine-interpreter";
import type { RecordingState } from "../../src/types/recording";
import { AppError, ErrorCodes } from "../../src/types/error";
import type {
  ActiveRecordingMode,
  TerminationCode,
} from "../../src/main/managers/recording-state-machine";

type RecordingManagerInternals = {
  machine: RecordingMachineInterpreter;
  currentSessionId: string | null;
  currentIsInstruct: boolean;
  terminationCode: TerminationCode | null;
  recordingStartedAt: number | null;
  recordingStoppedAt: number | null;
  systemAudioMuted: boolean;
  soundsMuted: boolean;
  audioChunks: Float32Array[];
  initPromise: Promise<void> | null;
  shortcutManager: { isPTTDraftActive(): boolean } | null;
  performStartSession(mode: ActiveRecordingMode): Promise<void>;
  performEndRecording(code?: TerminationCode | null): Promise<void>;
  initializeSession(sessionId: string): Promise<void>;
  handleAudioChunk(
    sessionId: string,
    chunk: Float32Array,
    isFinalChunk: boolean,
  ): Promise<void>;
  handleFinalChunk(sessionId: string): Promise<void>;
  writeAudioFile(
    sessionId: string,
    chunks: Float32Array[],
  ): Promise<string | null>;
  handleStreamingSessionFailure(sessionId: string, error: Error): Promise<void>;
  notifyNoAudio(): void;
  forceIdle(): Promise<void>;
  resetSessionState(
    expectedSessionId: string | null,
    options?: { force?: boolean },
  ): void;
  pasteTranscription(
    transcription: string,
    expectedSessionId?: string,
  ): Promise<void>;
  clearTimers(): void;
};

const createRecordingManager = (
  services: Record<string, unknown> = {},
): RecordingManager => RecordingManager.createForTests(services as never);

const internalsOf = (manager: RecordingManager): RecordingManagerInternals =>
  manager as unknown as RecordingManagerInternals;

describe("nullable dependencies", () => {
  // transcriptionService/nativeBridge are honestly `| null` (failed init /
  // platform gate). A missing service must take the flow's existing degraded
  // path — logged and contained — never an unhandled rejection.
  it("initializeSession degrades cleanly when transcription and bridge are null", async () => {
    const manager = createRecordingManager({
      transcriptionService: null,
      nativeBridge: null,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.systemAudioMuted = true;

    await expect(
      internals.initializeSession("session-1"),
    ).resolves.toBeUndefined();
    expect(internals.systemAudioMuted).toBe(false);
  });
});

describe("recording manager FSM interpreter", () => {
  it("starts the live session before awaiting speech-model lookup", async () => {
    const modelLookup = Promise.withResolvers<string>();
    const getSelectedModel = vi.fn(() => modelLookup.promise);
    const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
      () => true,
    );
    const manager = createRecordingManager({
      modelService: { getSelectedModel },
      transcriptionService: { beginStreamingSession },
    });
    const internals = internalsOf(manager);
    vi.spyOn(internals, "performStartSession").mockResolvedValue(undefined);

    const start = manager.signalStart();
    await vi.waitFor(() => {
      expect(getSelectedModel).toHaveBeenCalledOnce();
    });

    expect(beginStreamingSession).toHaveBeenCalledOnce();
    expect(beginStreamingSession.mock.invocationCallOrder[0]).toBeLessThan(
      getSelectedModel.mock.invocationCallOrder[0]!,
    );

    modelLookup.resolve("whisper-tiny");
    await start;
  });

  it.each(["whisper-tiny", null])(
    "cleanup revokes a live session when model lookup resolves to %s",
    async (selectedModel) => {
      const modelLookup = Promise.withResolvers<string | null>();
      const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
        () => true,
      );
      const cancelStreamingSession = vi.fn().mockResolvedValue(undefined);
      const manager = createRecordingManager({
        modelService: {
          getSelectedModel: vi.fn(() => modelLookup.promise),
        },
        transcriptionService: {
          beginStreamingSession,
          cancelStreamingSession,
        },
      });
      const internals = internalsOf(manager);
      const startSession = vi
        .spyOn(internals, "performStartSession")
        .mockResolvedValue(undefined);
      const notifications = vi.fn();
      manager.on("widget-notification", notifications);

      const start = manager.signalStart();
      await vi.waitFor(() => {
        expect(beginStreamingSession).toHaveBeenCalledOnce();
      });

      const sessionId = beginStreamingSession.mock.calls[0]![0];
      await manager.cleanup();
      modelLookup.resolve(selectedModel);
      await start;

      expect(cancelStreamingSession).toHaveBeenCalledOnce();
      expect(cancelStreamingSession).toHaveBeenCalledWith(sessionId);
      expect(startSession).not.toHaveBeenCalled();
      expect(notifications).not.toHaveBeenCalled();
      expect(manager.getState()).toBe("idle");
    },
  );

  it("I-49/I-52: retired initialization cannot start capture for a replacement", async () => {
    const firstVadReset = Promise.withResolvers<void>();
    const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
      () => true,
    );
    const resetVadForNewSession = vi
      .fn()
      .mockImplementationOnce(() => firstVadReset.promise)
      .mockResolvedValue(undefined);
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn().mockResolvedValue(undefined),
      getAccessibilityContext: vi.fn().mockReturnValue(null),
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
      },
      settingsService: {
        getPreferences: vi.fn().mockResolvedValue({
          muteSystemAudio: false,
          muteDictationSounds: false,
        }),
      },
      nativeBridge,
      transcriptionService: {
        beginStreamingSession,
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
        resetVadForNewSession,
        warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
      },
    });
    const internals = internalsOf(manager);

    const firstStart = manager.signalStart();
    await vi.waitFor(() => {
      expect(resetVadForNewSession).toHaveBeenCalledOnce();
    });

    await internals.forceIdle();
    const replacementStart = manager.signalStart();
    firstVadReset.resolve();
    await Promise.all([firstStart, replacementStart]);

    const methods = nativeBridge.call.mock.calls.map(([method]) => method);
    expect(methods).toEqual(["stopRecording", "startRecording"]);
    expect(beginStreamingSession).toHaveBeenCalledTimes(2);
    expect(internals.currentSessionId).toBe(
      beginStreamingSession.mock.calls[1]![0],
    );
    expect(manager.getState()).toBe("recording");
    internals.clearTimers();
  });

  it("I-49/I-52: a retired native start is stopped before replacement capture starts", async () => {
    const firstNativeStart = Promise.withResolvers<{ success: boolean }>();
    const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
      () => true,
    );
    let nativeStartCount = 0;
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn().mockResolvedValue(undefined),
      getAccessibilityContext: vi.fn().mockReturnValue(null),
      call: vi.fn((method: string) => {
        if (method === "startRecording" && nativeStartCount++ === 0) {
          return firstNativeStart.promise;
        }
        return Promise.resolve({ success: true });
      }),
    };
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
      },
      settingsService: {
        getPreferences: vi.fn().mockResolvedValue({
          muteSystemAudio: false,
          muteDictationSounds: false,
        }),
      },
      nativeBridge,
      transcriptionService: {
        beginStreamingSession,
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
        resetVadForNewSession: vi.fn().mockResolvedValue(undefined),
        warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
      },
    });
    const internals = internalsOf(manager);

    const firstStart = manager.signalStart();
    await vi.waitFor(() => {
      expect(nativeBridge.call).toHaveBeenCalledWith("startRecording", {
        muteSystemAudio: false,
        muteSounds: false,
      });
    });

    await internals.forceIdle();
    const replacementStart = manager.signalStart();
    firstNativeStart.resolve({ success: true });
    await Promise.all([firstStart, replacementStart]);

    expect(nativeBridge.call.mock.calls.map(([method]) => method)).toEqual([
      "startRecording",
      "stopRecording",
      "stopRecording",
      "startRecording",
    ]);
    expect(beginStreamingSession).toHaveBeenCalledTimes(2);
    expect(internals.currentSessionId).toBe(
      beginStreamingSession.mock.calls[1]![0],
    );
    expect(manager.getState()).toBe("recording");
    internals.clearTimers();
  });

  it("I-41/I-49: a queued stop performs no work after its session is force-idled", async () => {
    const vadReset = Promise.withResolvers<void>();
    const cancelStreamingSession = vi.fn().mockResolvedValue(undefined);
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn().mockResolvedValue(undefined),
      getAccessibilityContext: vi.fn().mockReturnValue(null),
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
      },
      nativeBridge,
      transcriptionService: {
        beginStreamingSession: vi.fn(() => true),
        cancelStreamingSession,
        resetVadForNewSession: vi.fn(() => vadReset.promise),
      },
    });
    const internals = internalsOf(manager);

    const start = manager.signalStart();
    await vi.waitFor(() => {
      expect(manager.getState()).toBe("recording");
    });
    const stop = manager.signalStop();
    expect(manager.getState()).toBe("stopping");

    await internals.forceIdle();
    vadReset.resolve();
    await Promise.all([start, stop]);

    expect(nativeBridge.call.mock.calls.map(([method]) => method)).toEqual([
      "stopRecording",
    ]);
    expect(cancelStreamingSession).toHaveBeenCalledOnce();
    expect(manager.getState()).toBe("idle");
  });

  it("I-49/I-52: replacement native start waits for an in-flight force-idle stop", async () => {
    const nativeStop = Promise.withResolvers<{ success: boolean }>();
    const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
      () => true,
    );
    const nativeBridge = {
      call: vi.fn((method: string) =>
        method === "stopRecording"
          ? nativeStop.promise
          : Promise.resolve({ success: true }),
      ),
      refreshAccessibilityContext: vi.fn().mockResolvedValue(undefined),
      getAccessibilityContext: vi.fn().mockReturnValue(null),
    };
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
      },
      settingsService: {
        getPreferences: vi.fn().mockResolvedValue({
          muteSystemAudio: true,
          muteDictationSounds: false,
        }),
      },
      nativeBridge,
      transcriptionService: {
        beginStreamingSession,
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
        resetVadForNewSession: vi.fn().mockResolvedValue(undefined),
        warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
      },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "retired-session";
    internals.systemAudioMuted = true;
    internals.soundsMuted = true;
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    const forceIdle = internals.forceIdle();
    await vi.waitFor(() => {
      expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
        wasMuted: true,
        muteSounds: true,
      });
    });

    // The old finalization can reach IDLE while the recovery stop is pending.
    internals.resetSessionState("retired-session");
    const replacementStart = manager.signalStart();
    await vi.waitFor(() => {
      expect(manager.getState()).toBe("starting");
    });

    expect(beginStreamingSession).toHaveBeenCalledOnce();
    expect(nativeBridge.call.mock.calls.map(([method]) => method)).toEqual([
      "stopRecording",
    ]);

    nativeStop.resolve({ success: true });
    await Promise.all([forceIdle, replacementStart]);

    expect(internals.currentSessionId).toBe(
      beginStreamingSession.mock.calls[0]![0],
    );
    expect(internals.systemAudioMuted).toBe(true);
    expect(manager.getState()).toBe("recording");
    expect(nativeBridge.call.mock.calls.map(([method]) => method)).toEqual([
      "stopRecording",
      "startRecording",
    ]);
    internals.clearTimers();
  });

  it("I-55: ends the empty live session and reports a missing speech model", async () => {
    const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
      () => true,
    );
    const cancelStreamingSession = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue(null),
      },
      transcriptionService: {
        beginStreamingSession,
        cancelStreamingSession,
      },
    });
    const widgetNotifications: Array<{
      type: string;
      errorCode?: string;
    }> = [];
    manager.on("widget-notification", (notification) => {
      widgetNotifications.push(notification);
    });

    await manager.signalStart();

    const sessionId = beginStreamingSession.mock.calls[0]![0];
    expect(cancelStreamingSession).toHaveBeenCalledWith(sessionId);
    expect(manager.getState()).toBe("idle");
    expect(widgetNotifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.MODEL_MISSING,
      },
    ]);
  });

  it("ends the empty live session when speech-model lookup fails", async () => {
    const lookupError = new Error("model lookup failed");
    const beginStreamingSession = vi.fn<(sessionId: string) => boolean>(
      () => true,
    );
    const cancelStreamingSession = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockRejectedValue(lookupError),
      },
      transcriptionService: {
        beginStreamingSession,
        cancelStreamingSession,
      },
    });

    await expect(manager.signalStart()).rejects.toBe(lookupError);

    const sessionId = beginStreamingSession.mock.calls[0]![0];
    expect(cancelStreamingSession).toHaveBeenCalledWith(sessionId);
    expect(manager.getState()).toBe("idle");
  });

  it("I-55: reports a terminal error when a History retry blocks recording admission", async () => {
    const beginStreamingSession = vi.fn(() => false);
    const nativeBridge = {
      call: vi.fn(),
    };
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
      },
      transcriptionService: {
        beginStreamingSession,
      },
      nativeBridge,
    });
    const widgetNotifications: Array<{
      type: string;
      errorCode?: string;
    }> = [];
    manager.on("widget-notification", (notification) => {
      widgetNotifications.push(notification);
    });

    await expect(manager.signalStart()).resolves.toBeUndefined();

    expect(beginStreamingSession).toHaveBeenCalledOnce();
    expect(nativeBridge.call).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("idle");
    expect(widgetNotifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.RETRY_IN_PROGRESS,
      },
    ]);
  });

  it("I-51: stops only the matching active session on terminal transcription failure", async () => {
    let reportFailure: ((error: Error) => void) | undefined;
    const beginStreamingSession = vi.fn(
      (_sessionId: string, onTerminalFailure?: (error: Error) => void) => {
        reportFailure = onTerminalFailure;
        return true;
      },
    );
    const manager = createRecordingManager({
      modelService: {
        getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
      },
      transcriptionService: {
        beginStreamingSession,
      },
    });
    const internals = internalsOf(manager);
    vi.spyOn(internals, "performStartSession").mockResolvedValue(undefined);

    await manager.signalStart();
    const activeSessionId = internals.currentSessionId;
    expect(activeSessionId).not.toBeNull();
    expect(reportFailure).toEqual(expect.any(Function));
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
    const stop = vi
      .spyOn(internals, "performEndRecording")
      .mockResolvedValue(undefined);
    const failure = new AppError(
      "Word limit exceeded",
      ErrorCodes.QUOTA_EXCEEDED,
    );

    await internals.handleStreamingSessionFailure("stale-session", failure);
    expect(internals.machine.currentState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
    expect(stop).not.toHaveBeenCalled();

    reportFailure?.(failure);

    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledWith(null);
    });
    expect(internals.machine.currentState).toEqual({ tag: "STOP_N" });
  });

  it("I-27: sets stop intent before broadcasting stopping", () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    internals.terminationCode = null;

    const stoppingSnapshots: Array<{
      state: RecordingState;
      terminationCode: TerminationCode | null;
      hasPendingStop: boolean;
    }> = [];

    manager.on("state-changed", (state: RecordingState) => {
      if (state !== "stopping") {
        return;
      }

      stoppingSnapshots.push({
        state,
        terminationCode: internals.terminationCode,
        hasPendingStop: Boolean(internals.machine.currentPendingStopSession),
      });
    });

    const commands = internals.machine.transition({ type: "noAudioTimeout" });

    expect(commands).toEqual([
      { type: "notifyNoAudio" },
      { type: "stopSession", code: "no_audio" },
    ]);
    expect(stoppingSnapshots).toEqual([
      {
        state: "stopping",
        terminationCode: "no_audio",
        hasPendingStop: true,
      },
    ]);
  });

  it("I-55/I-57: ends a failed microphone restart with one terminal resolve", async () => {
    const priorFinalChunkProcessing = Promise.withResolvers<void>();
    const finalTranscript = Promise.withResolvers<string>();
    let terminalError: Error | undefined;
    const nativeBridge = {
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const transcriptionService = {
      latchStreamingSessionFailure: vi.fn(
        (_sessionId: string, error: Error) => {
          terminalError = error;
        },
      ),
      processStreamingChunk: vi.fn(() => priorFinalChunkProcessing.promise),
      finalizeSession: vi.fn(() => finalTranscript.promise),
    };
    const manager = createRecordingManager({
      nativeBridge,
      transcriptionService,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
    const priorFinalChunk = new Float32Array([0.25, -0.25]);
    const writeAudioFile = vi
      .spyOn(internals, "writeAudioFile")
      .mockResolvedValue("/tmp/session-1.wav");
    const handleFinalChunk = vi.spyOn(internals, "handleFinalChunk");
    const forceIdle = vi.spyOn(internals, "forceIdle");
    const pasteTranscription = vi.spyOn(internals, "pasteTranscription");
    const notifications: Array<{
      type: string;
      errorCode?: string;
      params?: Record<string, string>;
      uiMessage?: string;
    }> = [];
    manager.on("widget-notification", (notification) => {
      notifications.push(notification);
    });

    // A capture restart flushes the previous worklet before the replacement
    // attempt starts. Main can still be processing that final IPC when the
    // replacement attempt fails.
    const priorFinal = internals.handleAudioChunk(
      "session-1",
      priorFinalChunk,
      true,
    );
    await vi.waitFor(() => {
      expect(transcriptionService.processStreamingChunk).toHaveBeenCalledOnce();
    });

    const captureFailure = manager.handleCaptureStartFailure({
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    });
    await vi.waitFor(() => {
      expect(transcriptionService.finalizeSession).toHaveBeenCalledOnce();
    });

    priorFinalChunkProcessing.resolve();
    await vi.waitFor(() => {
      expect(handleFinalChunk).toHaveBeenCalledTimes(2);
    });
    expect(writeAudioFile).toHaveBeenCalledOnce();
    expect(transcriptionService.finalizeSession).toHaveBeenCalledOnce();

    finalTranscript.reject(terminalError);
    await Promise.all([priorFinal, captureFailure]);

    expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
      wasMuted: false,
      muteSounds: false,
    });
    expect(
      transcriptionService.latchStreamingSessionFailure,
    ).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        errorCode: ErrorCodes.MICROPHONE_CAPTURE_FAILED,
        uiMessage: "Permission denied",
      }),
    );
    expect(notifications).toEqual([
      {
        type: "transcription_failed",
        errorCode: ErrorCodes.MICROPHONE_CAPTURE_FAILED,
        uiMessage: "Permission denied",
        uiTitle: undefined,
        traceId: undefined,
      },
    ]);
    expect(transcriptionService.finalizeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        audioFilePath: "/tmp/session-1.wav",
      }),
    );
    expect(writeAudioFile).toHaveBeenCalledWith("session-1", [priorFinalChunk]);
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(forceIdle).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("idle");
  });

  it("I-55: reports the microphone cause when transcription service initialization failed", async () => {
    const nativeBridge = {
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const manager = createRecordingManager({
      nativeBridge,
      transcriptionService: null,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    const pasteTranscription = vi.spyOn(internals, "pasteTranscription");
    const notifications: Array<{
      type: string;
      errorCode?: string;
      uiMessage?: string;
    }> = [];
    manager.on("widget-notification", (notification) => {
      notifications.push(notification);
    });

    await manager.handleCaptureStartFailure({
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        type: "transcription_failed",
        errorCode: ErrorCodes.MICROPHONE_CAPTURE_FAILED,
        uiMessage: "Permission denied",
      }),
    ]);
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("idle");
  });

  it("I-55: ignores a microphone start failure from an older session", async () => {
    const nativeBridge = { call: vi.fn() };
    const transcriptionService = {
      latchStreamingSessionFailure: vi.fn(),
    };
    const manager = createRecordingManager({
      nativeBridge,
      transcriptionService,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-2";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });

    await manager.handleCaptureStartFailure({
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    });

    expect(
      transcriptionService.latchStreamingSessionFailure,
    ).not.toHaveBeenCalled();
    expect(nativeBridge.call).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("recording");
  });

  it("I-49/I-52/I-54: discards a delayed chunk from a retired capture session", async () => {
    const processStreamingChunk = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      transcriptionService: { processStreamingChunk },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "replacement-session";
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });

    await internals.handleAudioChunk(
      "retired-session",
      new Float32Array([0.1, 0.2]),
      false,
    );

    expect(internals.audioChunks).toEqual([]);
    expect(processStreamingChunk).not.toHaveBeenCalled();
    expect(internals.machine.currentState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
  });

  it("I-49/I-52: a retired session cannot reset its replacement", () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    const replacementChunk = new Float32Array([0.2]);
    internals.currentSessionId = "replacement-session";
    internals.currentIsInstruct = true;
    internals.audioChunks = [replacementChunk];
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: true,
    });

    internals.resetSessionState("retired-session", { force: true });

    expect(internals.currentSessionId).toBe("replacement-session");
    expect(internals.currentIsInstruct).toBe(true);
    expect(internals.audioChunks).toEqual([replacementChunk]);
    expect(internals.machine.currentState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
  });

  it("I-49/I-52/I-54: discards an admitted chunk when its session retires during initialization", async () => {
    const initialization = Promise.withResolvers<void>();
    const processStreamingChunk = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      transcriptionService: { processStreamingChunk },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "retired-session";
    internals.initPromise = initialization.promise;
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });

    const oldChunk = internals.handleAudioChunk(
      "retired-session",
      new Float32Array([0.1]),
      false,
    );
    internals.currentSessionId = "replacement-session";
    internals.audioChunks = [new Float32Array([0.2])];
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    initialization.resolve();
    await oldChunk;

    expect(internals.audioChunks).toEqual([new Float32Array([0.2])]);
    expect(processStreamingChunk).not.toHaveBeenCalled();
    expect(internals.machine.currentState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
  });

  it.each([
    { name: "non-final", isFinal: false },
    { name: "final", isFinal: true },
  ])(
    "I-49/I-52/I-54: stops a retired $name chunk after an asynchronous draft latch",
    async ({ isFinal }) => {
      const draftUpdate = Promise.withResolvers<void>();
      const updateStreamingSession = vi.fn(() => draftUpdate.promise);
      const processStreamingChunk = vi.fn().mockResolvedValue(undefined);
      const manager = createRecordingManager({
        transcriptionService: {
          updateStreamingSession,
          processStreamingChunk,
        },
      });
      const internals = internalsOf(manager);
      const replacementChunk = new Float32Array([0.2]);
      internals.currentSessionId = "retired-session";
      internals.shortcutManager = { isPTTDraftActive: () => true };
      internals.machine.__setStateForTesting({
        tag: "REC_HF",
        firstChunkReceived: true,
      });

      const oldChunk = internals.handleAudioChunk(
        "retired-session",
        new Float32Array([0.1]),
        isFinal,
      );
      await vi.waitFor(() => {
        expect(updateStreamingSession).toHaveBeenCalledOnce();
      });

      internals.currentSessionId = "replacement-session";
      internals.currentIsInstruct = false;
      internals.audioChunks = [replacementChunk];
      draftUpdate.resolve();
      await oldChunk;

      expect(processStreamingChunk).not.toHaveBeenCalled();
      expect(internals.currentIsInstruct).toBe(false);
      expect(internals.audioChunks).toEqual([replacementChunk]);
    },
  );

  it("I-28: drops audio captured during the start-sound window so the beep isn't recorded", async () => {
    const processStreamingChunk = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      transcriptionService: { processStreamingChunk },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.recordingStartedAt = 1;
    internals.terminationCode = null;
    internals.soundsMuted = false;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });

    // Native start (beep + system-audio mute) still in flight: a chunk arriving
    // now is captured while the start sound is playing.
    let resolveInit: () => void = () => {};
    internals.initPromise = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });

    const beepWindowChunk = new Float32Array([0.1, 0.2]);
    const pending = internals.handleAudioChunk(
      "session-1",
      beepWindowChunk,
      false,
    );
    resolveInit();
    await pending;

    // The beep-window chunk is discarded: not buffered, not streamed.
    expect(internals.audioChunks.length).toBe(0);
    expect(processStreamingChunk).not.toHaveBeenCalled();

    // A chunk captured after native start completed (initPromise cleared) is kept.
    internals.initPromise = null;
    const postBeepChunk = new Float32Array([0.3, 0.4]);
    await internals.handleAudioChunk("session-1", postBeepChunk, false);

    expect(internals.audioChunks.length).toBe(1);
    expect(processStreamingChunk).toHaveBeenCalledTimes(1);
  });

  it("I-28: keeps start-window audio when dictation sounds are muted", async () => {
    const processStreamingChunk = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      transcriptionService: { processStreamingChunk },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.recordingStartedAt = 1;
    internals.terminationCode = null;
    internals.soundsMuted = true;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });

    let resolveInit: () => void = () => {};
    internals.initPromise = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });

    const chunk = new Float32Array([0.1, 0.2]);
    const pending = internals.handleAudioChunk("session-1", chunk, false);
    resolveInit();
    await pending;

    // No beep played, so the start-window audio is real user audio — keep it.
    expect(internals.audioChunks.length).toBe(1);
    expect(processStreamingChunk).toHaveBeenCalledTimes(1);
  });

  it("I-29: waits for the accepted stop workflow before finalizing a final chunk", async () => {
    const manager = createRecordingManager({
      transcriptionService: {},
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    internals.machine.transition({ type: "pttPress", quick: true });

    let finalized = false;
    const finalization = internals.handleFinalChunk("session-1").then(() => {
      finalized = true;
    });
    await Promise.resolve();

    expect(finalized).toBe(false);
    expect(internals.machine.currentState).toEqual({
      tag: "STOP_C",
      code: "quick_release",
    });

    internals.machine.resolvePendingStopSession();
    await finalization;

    expect(finalized).toBe(true);
    expect(internals.machine.currentState).toEqual({ tag: "IDLE" });
  });

  it("I-30: runs one stop workflow for repeated public stop requests", async () => {
    const nativeStop = Promise.withResolvers<{ success: boolean }>();
    const nativeBridge = {
      call: vi.fn(() => nativeStop.promise),
    };
    const manager = createRecordingManager({ nativeBridge });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: true,
    });

    const firstStop = manager.signalStop();
    try {
      await vi.waitFor(() => {
        expect(nativeBridge.call).toHaveBeenCalledOnce();
      });
      const pendingStop = internals.machine.currentPendingStopSession;
      expect(pendingStop).not.toBeNull();

      await manager.signalStop();

      expect(nativeBridge.call).toHaveBeenCalledOnce();
      expect(internals.machine.currentPendingStopSession).toBe(pendingStop);
    } finally {
      nativeStop.resolve({ success: true });
      await firstStop;
      internals.clearTimers();
    }
  });

  it("I-31: interrupted_start cancels without writing, finalizing, or pasting", async () => {
    const nativeBridge = {
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const transcriptionService = {
      cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      finalizeSession: vi.fn(),
    };
    const manager = createRecordingManager({
      nativeBridge,
      transcriptionService,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "STARTING",
      mode: "hands-free",
    });
    const writeAudioFile = vi
      .spyOn(internals, "writeAudioFile")
      .mockResolvedValue(null);
    const pasteTranscription = vi
      .spyOn(internals, "pasteTranscription")
      .mockResolvedValue(undefined);

    const cancelled = vi.fn();
    manager.on("recording-cancelled", cancelled);

    await manager.signalStop();

    expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
      wasMuted: false,
      muteSounds: false,
    });
    expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
      "session-1",
    );
    expect(cancelled).toHaveBeenCalledWith({
      sessionId: "session-1",
      code: "interrupted_start",
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(writeAudioFile).not.toHaveBeenCalled();
    expect(transcriptionService.finalizeSession).not.toHaveBeenCalled();
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(internals.machine.currentPendingStopSession).toBeNull();
    expect(manager.getState()).toBe("idle");
  });

  it("cleanup during STARTING completes native start before tearing down", async () => {
    const modelService = {
      getSelectedModel: vi.fn().mockResolvedValue({ id: "model-1" }),
    };
    const transcriptionService = {
      beginStreamingSession: vi.fn<(sessionId: string) => boolean>(() => true),
      resetVadForNewSession: vi.fn().mockResolvedValue(undefined),
      warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
      cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
    };
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn().mockResolvedValue(undefined),
      getAccessibilityContext: vi.fn().mockReturnValue(null),
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const settingsService = {
      getPreferences: vi.fn().mockResolvedValue({
        muteSystemAudio: false,
        muteDictationSounds: false,
      }),
    };
    const manager = createRecordingManager({
      modelService,
      transcriptionService,
      nativeBridge,
      settingsService,
    });

    let cleanupPromise: Promise<void> | null = null;
    manager.on("state-changed", (state: RecordingState) => {
      if (state === "starting") {
        cleanupPromise = manager.cleanup();
      }
    });

    await manager.signalStart();
    expect(cleanupPromise).not.toBeNull();
    await cleanupPromise;

    expect(nativeBridge.call.mock.calls.map(([method]) => method)).toEqual([
      "startRecording",
      "stopRecording",
    ]);
    expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledTimes(
      1,
    );
    expect(transcriptionService.beginStreamingSession).toHaveBeenCalledOnce();
    expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
      transcriptionService.beginStreamingSession.mock.calls[0]![0],
    );
    expect(
      transcriptionService.beginStreamingSession.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transcriptionService.resetVadForNewSession.mock.invocationCallOrder[0]!,
    );
    expect(
      transcriptionService.beginStreamingSession.mock.invocationCallOrder[0],
    ).toBeLessThan(nativeBridge.call.mock.invocationCallOrder[0]!);
    expect(manager.getState()).toBe("idle");
  });

  it.each([
    ["ptt", { tag: "REC_PTT", firstChunkReceived: false }],
    ["hands-free", { tag: "REC_HF", firstChunkReceived: false }],
  ] as const)(
    "I-46: exits STARTING synchronously for %s before initialization resolves",
    async (mode, expectedState) => {
      const initialization = Promise.withResolvers<void>();
      const manager = createRecordingManager();
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.machine.__setStateForTesting({ tag: "STARTING", mode });
      vi.spyOn(internals, "initializeSession").mockReturnValue(
        initialization.promise,
      );

      let startSettled = false;
      const start = internals.performStartSession(mode).then(() => {
        startSettled = true;
      });

      try {
        expect(internals.machine.currentState).toEqual(expectedState);
        await Promise.resolve();
        expect(startSettled).toBe(false);
      } finally {
        initialization.resolve();
        await start;
        internals.clearTimers();
      }
    },
  );

  it("does not overwrite recordingStartedAt when start is already stopping", async () => {
    const transcriptionService = {
      resetVadForNewSession: vi.fn().mockResolvedValue(undefined),
      warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
    };
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn().mockResolvedValue(undefined),
      getAccessibilityContext: vi.fn().mockReturnValue(null),
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const settingsService = {
      getPreferences: vi.fn().mockResolvedValue({
        muteSystemAudio: false,
        muteDictationSounds: false,
      }),
    };
    const manager = createRecordingManager({
      transcriptionService,
      nativeBridge,
      settingsService,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.recordingStartedAt = 123;
    internals.machine.__setStateForTesting({
      tag: "STOP_C",
      code: "interrupted_start",
    });

    await internals.performStartSession("hands-free");

    expect(internals.recordingStartedAt).toBe(123);
    expect(internals.machine.currentState).toEqual({
      tag: "STOP_C",
      code: "interrupted_start",
    });
  });

  it("I-32: times out instead of waiting forever for a pending stop command", async () => {
    vi.useFakeTimers();
    try {
      const nativeBridge = {
        call: vi.fn().mockResolvedValue({ success: true }),
      };
      const transcriptionService = {
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      };
      const manager = createRecordingManager({
        nativeBridge,
        transcriptionService,
      });
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.machine.__setStateForTesting({
        tag: "REC_HF",
        firstChunkReceived: false,
      });
      internals.machine.transition({ type: "pttPress", quick: true });

      const finalization = internals.handleFinalChunk("session-1");
      await vi.advanceTimersByTimeAsync(10_000);
      await finalization;

      expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
        wasMuted: false,
        muteSounds: false,
      });
      expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
        "session-1",
      );
      expect(internals.machine.currentPendingStopSession).toBeNull();
      expect(internals.machine.currentState).toEqual({ tag: "IDLE" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("I-32: cleanup force-stops capture before resetting a timed-out pending stop", async () => {
    vi.useFakeTimers();
    try {
      const nativeBridge = {
        call: vi.fn().mockResolvedValue({ success: true }),
      };
      const transcriptionService = {
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      };
      const manager = createRecordingManager({
        nativeBridge,
        transcriptionService,
      });
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.systemAudioMuted = true;
      internals.soundsMuted = true;
      internals.machine.__setStateForTesting({
        tag: "REC_HF",
        firstChunkReceived: false,
      });
      internals.machine.transition({ type: "pttPress", quick: true });

      const cleanup = manager.cleanup();
      await vi.advanceTimersByTimeAsync(10_000);
      await cleanup;

      expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
        "session-1",
      );
      expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
        wasMuted: true,
        muteSounds: true,
      });
      expect(internals.machine.currentPendingStopSession).toBeNull();
      expect(manager.getState()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates concurrent force-idle cleanup", async () => {
    let resolveStopRecording!: () => void;
    const stopRecording = new Promise<{ success: boolean }>((resolve) => {
      resolveStopRecording = () => resolve({ success: true });
    });
    const nativeBridge = {
      call: vi.fn().mockReturnValue(stopRecording),
    };
    const transcriptionService = {
      cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
    };
    const manager = createRecordingManager({
      nativeBridge,
      transcriptionService,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.systemAudioMuted = true;
    internals.soundsMuted = true;

    const firstForceIdle = internals.forceIdle();
    const secondForceIdle = internals.forceIdle();
    await Promise.resolve();

    expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledTimes(
      1,
    );
    expect(nativeBridge.call).toHaveBeenCalledTimes(1);

    resolveStopRecording();
    await Promise.all([firstForceIdle, secondForceIdle]);

    expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
      wasMuted: true,
      muteSounds: true,
    });
    expect(manager.getState()).toBe("idle");
  });

  it("cleanup force-stops when native stop resolved but no final chunk arrived", async () => {
    vi.useFakeTimers();
    try {
      const nativeBridge = {
        call: vi.fn().mockResolvedValue({ success: true }),
      };
      const transcriptionService = {
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      };
      const manager = createRecordingManager({
        nativeBridge,
        transcriptionService,
      });
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.systemAudioMuted = true;
      internals.soundsMuted = true;
      internals.machine.__setStateForTesting({
        tag: "STOP_N",
      });

      const cleanup = manager.cleanup();
      await vi.advanceTimersByTimeAsync(1000);
      await cleanup;

      expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
        "session-1",
      );
      expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
        wasMuted: true,
        muteSounds: true,
      });
      expect(manager.getState()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("I-32: recovers automatically when native stop completes without a final chunk", async () => {
    vi.useFakeTimers();
    try {
      const nativeBridge = {
        call: vi.fn().mockResolvedValue({ success: true }),
      };
      const transcriptionService = {
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      };
      const manager = createRecordingManager({
        nativeBridge,
        transcriptionService,
      });
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.machine.__setStateForTesting({
        tag: "REC_HF",
        firstChunkReceived: true,
      });

      await manager.signalStop();
      expect(manager.getState()).toBe("stopping");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(manager.getState()).toBe("idle");
      expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
        "session-1",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stopping while an already-received final chunk is finalizing", async () => {
    vi.useFakeTimers();
    try {
      const nativeStop = Promise.withResolvers<{ success: boolean }>();
      const finalTranscript = Promise.withResolvers<string>();
      const nativeBridge = {
        call: vi.fn(() => nativeStop.promise),
      };
      const transcriptionService = {
        finalizeSession: vi.fn(() => finalTranscript.promise),
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      };
      const manager = createRecordingManager({
        nativeBridge,
        transcriptionService,
      });
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.machine.__setStateForTesting({
        tag: "REC_HF",
        firstChunkReceived: true,
      });

      const stop = manager.signalStop();
      await vi.waitFor(() => {
        expect(nativeBridge.call).toHaveBeenCalledWith("stopRecording", {
          wasMuted: false,
          muteSounds: false,
        });
      });

      const finalization = internals.handleFinalChunk("session-1");
      nativeStop.resolve({ success: true });
      await vi.waitFor(() => {
        expect(transcriptionService.finalizeSession).toHaveBeenCalledOnce();
      });

      await vi.advanceTimersByTimeAsync(10_000);

      expect(manager.getState()).toBe("stopping");
      expect(
        transcriptionService.cancelStreamingSession,
      ).not.toHaveBeenCalled();

      finalTranscript.resolve("");
      await Promise.all([stop, finalization]);
      expect(manager.getState()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dismissCurrentSession routing", () => {
  it("I-37: recording dismiss keeps audio, persists dismissed, and never pastes", async () => {
    const nativeBridge = {
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const transcriptionService = {
      cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
      saveDismissedTranscription: vi.fn().mockResolvedValue(undefined),
      finalizeSession: vi.fn(),
    };
    const manager = createRecordingManager({
      nativeBridge,
      transcriptionService,
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
    const capturedChunk = new Float32Array([0.1]);
    const finalChunk = new Float32Array([0.2]);
    internals.audioChunks = [capturedChunk];
    const writeAudioFile = vi
      .spyOn(internals, "writeAudioFile")
      .mockResolvedValue("/tmp/session-1.wav");
    const pasteTranscription = vi.spyOn(internals, "pasteTranscription");
    const cancelled = vi.fn();
    manager.on("recording-cancelled", cancelled);

    await manager.dismissCurrentSession();

    expect(internals.machine.currentState).toEqual({
      tag: "STOP_C",
      code: "user_dismissed",
    });
    await internals.handleAudioChunk("session-1", finalChunk, true);

    expect(writeAudioFile).toHaveBeenCalledWith("session-1", [
      capturedChunk,
      finalChunk,
    ]);
    expect(
      transcriptionService.saveDismissedTranscription,
    ).toHaveBeenCalledWith({
      sessionId: "session-1",
      audioFilePath: "/tmp/session-1.wav",
    });
    expect(transcriptionService.cancelStreamingSession).toHaveBeenCalledWith(
      "session-1",
    );
    expect(transcriptionService.finalizeSession).not.toHaveBeenCalled();
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledWith({
      sessionId: "session-1",
      code: "user_dismissed",
    });
    expect(manager.getState()).toBe("idle");
  });

  it("I-36: aborts the in-flight session during finalize", async () => {
    const abortSession = vi.fn();
    const cancelStreamingSession = vi.fn().mockResolvedValue(undefined);
    const manager = createRecordingManager({
      transcriptionService: {
        abortSession,
        cancelStreamingSession,
      },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.terminationCode = null;
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    await manager.dismissCurrentSession();

    expect(abortSession).toHaveBeenCalledWith("session-1");
    // The FSM moved to STOP_C{user_dismissed}; the mirror tracks it.
    expect(internals.terminationCode).toBe("user_dismissed");
    // Off-mutex abort, NOT the mutex-bound cancelStreamingSession.
    expect(cancelStreamingSession).not.toHaveBeenCalled();
  });

  it("is a no-op when idle", async () => {
    const abortSession = vi.fn();
    const manager = createRecordingManager({
      transcriptionService: { abortSession },
    });
    const internals = internalsOf(manager);
    internals.machine.__setStateForTesting({ tag: "IDLE" });

    await manager.dismissCurrentSession();

    expect(abortSession).not.toHaveBeenCalled();
  });
});

describe("final transcript delivery", () => {
  it("I-37: pastes the finalized transcript through the normal path", async () => {
    // The onboarding try-it relies on this exact behavior: the session runs
    // the full production pipeline and the paste lands in whatever field is
    // focused (the try-it textarea). No capture/reroute mode exists.
    const finalizeSession = vi.fn().mockResolvedValue("hello world");
    const manager = createRecordingManager({
      transcriptionService: { finalizeSession },
    });
    const internals = internalsOf(manager);
    const pasteSpy = vi
      .spyOn(internals, "pasteTranscription")
      .mockResolvedValue(undefined);

    internals.currentSessionId = "s1";
    internals.recordingStartedAt = 1;
    internals.terminationCode = null;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    await internals.handleFinalChunk("s1");

    expect(pasteSpy).toHaveBeenCalledTimes(1);
    expect(pasteSpy).toHaveBeenCalledWith("hello world", "s1");
    expect(manager.getState()).toBe("idle");
  });

  it("dispatches paste while the expected session retains delivery authority", async () => {
    const nativeBridge = {
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const manager = createRecordingManager({
      nativeBridge,
      settingsService: {
        getPreferences: vi.fn().mockResolvedValue({ preserveClipboard: false }),
      },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    await internals.pasteTranscription("hello world", "session-1");

    expect(nativeBridge.call).toHaveBeenCalledOnce();
    expect(nativeBridge.call).toHaveBeenCalledWith("pasteText", {
      transcript: "hello world",
      preserveClipboard: false,
    });
  });

  it("I-43: completes without native insertion when the host is unavailable", async () => {
    const finalizeSession = vi.fn().mockResolvedValue("hello world");
    const manager = createRecordingManager({
      nativeBridge: null,
      settingsService: {
        getPreferences: vi.fn().mockResolvedValue({ preserveClipboard: true }),
      },
      transcriptionService: { finalizeSession },
    });
    const internals = internalsOf(manager);
    const widgetNotifications: Array<{ type: string }> = [];
    manager.on("widget-notification", (notification: { type: string }) => {
      widgetNotifications.push(notification);
    });
    internals.currentSessionId = "session-1";
    internals.terminationCode = null;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    await internals.handleFinalChunk("session-1");

    expect(finalizeSession).toHaveBeenCalledOnce();
    expect(widgetNotifications).toEqual([]);
    expect(manager.getState()).toBe("idle");
  });

  it("I-43: stages a draft result without pasting it", async () => {
    const finalizeSession = vi.fn().mockResolvedValue("draft text");
    const manager = createRecordingManager({
      transcriptionService: { finalizeSession },
    });
    const internals = internalsOf(manager);
    const pasteTranscription = vi
      .spyOn(internals, "pasteTranscription")
      .mockResolvedValue(undefined);
    internals.currentSessionId = "draft-session";
    internals.currentIsInstruct = true;
    internals.terminationCode = null;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    await internals.handleFinalChunk("draft-session");

    expect(manager.getPendingDraft()).toEqual({
      sessionId: "draft-session",
      text: "draft text",
    });
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("idle");
  });

  it("I-49/I-52/I-54: retired WAV completion cannot clear replacement audio", async () => {
    const wavWrite = Promise.withResolvers<string | null>();
    const finalizeSession = vi.fn().mockResolvedValue("");
    const manager = createRecordingManager({
      nativeBridge: {
        call: vi.fn().mockResolvedValue({ success: true }),
      },
      transcriptionService: {
        cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
        finalizeSession,
      },
    });
    const internals = internalsOf(manager);
    const replacementChunk = new Float32Array([0.2]);
    internals.currentSessionId = "retired-session";
    internals.audioChunks = [new Float32Array([0.1])];
    internals.machine.__setStateForTesting({ tag: "STOP_N" });
    vi.spyOn(internals, "writeAudioFile").mockReturnValue(wavWrite.promise);

    const finalization = internals.handleFinalChunk("retired-session");
    await vi.waitFor(() => {
      expect(internals.writeAudioFile).toHaveBeenCalledOnce();
    });

    await internals.forceIdle();
    internals.currentSessionId = "replacement-session";
    internals.audioChunks = [replacementChunk];
    internals.machine.__setStateForTesting({
      tag: "STARTING",
      mode: "hands-free",
    });
    wavWrite.resolve("/tmp/retired.wav");
    await finalization;

    expect(finalizeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "retired-session" }),
    );
    expect(internals.currentSessionId).toBe("replacement-session");
    expect(internals.audioChunks).toEqual([replacementChunk]);
    expect(internals.machine.currentState).toEqual({
      tag: "STARTING",
      mode: "hands-free",
    });
  });

  it.each([
    { name: "draft staging", isDraft: true, rejects: false, dismissed: false },
    { name: "native paste", isDraft: false, rejects: false, dismissed: false },
    {
      name: "failure notification",
      isDraft: false,
      rejects: true,
      dismissed: false,
    },
    {
      name: "dismiss cancellation",
      isDraft: false,
      rejects: false,
      dismissed: true,
    },
  ])(
    "I-49/I-52/I-54: retired finalization cannot perform $name or reset its replacement",
    async ({ isDraft, rejects, dismissed }) => {
      const finalResult = Promise.withResolvers<string>();
      const dismissedSave = Promise.withResolvers<void>();
      const beginStreamingSession = vi.fn(() => true);
      const finalizeSession = vi.fn(() => finalResult.promise);
      const saveDismissedTranscription = vi.fn(() => dismissedSave.promise);
      const nativeBridge = {
        call: vi.fn().mockResolvedValue({ success: true }),
      };
      const manager = createRecordingManager({
        modelService: {
          getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
        },
        settingsService: {
          getPreferences: vi.fn().mockResolvedValue({
            preserveClipboard: false,
          }),
        },
        nativeBridge,
        transcriptionService: {
          beginStreamingSession,
          cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
          finalizeSession,
          saveDismissedTranscription,
        },
      });
      const internals = internalsOf(manager);
      const oldChunk = new Float32Array([0.1]);
      const replacementChunk = new Float32Array([0.2]);
      internals.currentSessionId = "retired-session";
      internals.currentIsInstruct = false;
      internals.audioChunks = [oldChunk];
      internals.terminationCode = dismissed ? "user_dismissed" : null;
      internals.machine.__setStateForTesting(
        dismissed
          ? { tag: "STOP_C", code: "user_dismissed" }
          : { tag: "STOP_N" },
      );
      vi.spyOn(internals, "writeAudioFile").mockResolvedValue(
        "/tmp/retired.wav",
      );
      const notifications: Array<{ type: string }> = [];
      manager.on("widget-notification", (notification) => {
        notifications.push(notification);
      });
      const cancelled = vi.fn();
      manager.on("recording-cancelled", cancelled);

      const finalization = internals.handleFinalChunk("retired-session");
      await vi.waitFor(() => {
        expect(
          dismissed ? saveDismissedTranscription : finalizeSession,
        ).toHaveBeenCalledOnce();
      });

      await internals.forceIdle();
      vi.spyOn(internals, "performStartSession").mockResolvedValue(undefined);
      await manager.signalStart();
      const replacementSessionId = internals.currentSessionId;
      expect(replacementSessionId).not.toBe("retired-session");
      internals.currentIsInstruct = isDraft;
      internals.audioChunks = [replacementChunk];

      if (dismissed) {
        dismissedSave.resolve();
      } else if (rejects) {
        finalResult.reject(new Error("old finalization failed"));
      } else {
        finalResult.resolve("old transcript");
      }
      await finalization;

      expect(internals.currentSessionId).toBe(replacementSessionId);
      expect(internals.currentIsInstruct).toBe(isDraft);
      expect(internals.audioChunks).toEqual([replacementChunk]);
      expect(internals.machine.currentState).toEqual({
        tag: "STARTING",
        mode: "hands-free",
      });
      expect(manager.getPendingDraft()).toBeNull();
      expect(notifications).toEqual([]);
      expect(cancelled).not.toHaveBeenCalled();
      expect(
        nativeBridge.call.mock.calls.filter(
          ([method]) => method === "pasteText",
        ),
      ).toEqual([]);
    },
  );

  it.each(["success", "dismissed"] as const)(
    "I-40: returns to IDLE after %s and accepts the next start",
    async (outcome) => {
      const beginStreamingSession = vi.fn(() => true);
      const finalizeSession =
        outcome === "success"
          ? vi.fn().mockResolvedValue("hello world")
          : vi
              .fn()
              .mockRejectedValue(
                new AppError("Recording dismissed", ErrorCodes.USER_DISMISSED),
              );
      const manager = createRecordingManager({
        modelService: {
          getSelectedModel: vi.fn().mockResolvedValue("whisper-tiny"),
        },
        transcriptionService: {
          finalizeSession,
          beginStreamingSession,
        },
      });
      const internals = internalsOf(manager);
      const pasteTranscription = vi
        .spyOn(internals, "pasteTranscription")
        .mockResolvedValue(undefined);
      internals.currentSessionId = "completed-session";
      internals.terminationCode = null;
      internals.audioChunks = [];
      internals.machine.__setStateForTesting({ tag: "STOP_N" });

      await internals.handleFinalChunk("completed-session");
      expect(manager.getState()).toBe("idle");
      expect(pasteTranscription).toHaveBeenCalledTimes(
        outcome === "success" ? 1 : 0,
      );

      const startSession = vi
        .spyOn(internals, "performStartSession")
        .mockResolvedValue(undefined);
      await manager.signalStart();

      expect(beginStreamingSession).toHaveBeenCalledOnce();
      expect(startSession).toHaveBeenCalledWith("hands-free");
      expect(internals.machine.currentState).toEqual({
        tag: "STARTING",
        mode: "hands-free",
      });
    },
  );

  it("I-50: a post-seal dismiss preserves success but revokes pending insertion", async () => {
    const preferences = Promise.withResolvers<{ preserveClipboard: boolean }>();
    const nativeBridge = {
      call: vi.fn().mockResolvedValue({ success: true }),
    };
    const abortSession = vi.fn();
    const getPreferences = vi.fn(() => preferences.promise);
    const manager = createRecordingManager({
      nativeBridge,
      settingsService: { getPreferences },
      transcriptionService: {
        finalizeSession: vi.fn().mockResolvedValue("sealed transcript"),
        abortSession,
      },
    });
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.terminationCode = null;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    const finalization = internals.handleFinalChunk("session-1");
    await vi.waitFor(() => {
      expect(getPreferences).toHaveBeenCalledOnce();
    });

    await manager.dismissCurrentSession();
    expect(abortSession).toHaveBeenCalledWith("session-1");
    expect(internals.machine.currentState).toEqual({
      tag: "STOP_C",
      code: "user_dismissed",
    });

    preferences.resolve({ preserveClipboard: false });
    await finalization;

    expect(nativeBridge.call).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("idle");
  });

  it.each([
    ["I-44", "quick_release"],
    ["I-45", "no_audio"],
  ] as const)(
    "%s: %s cancels without writing, finalizing, or pasting",
    async (_contractId, code) => {
      const finalizeSession = vi.fn();
      const manager = createRecordingManager({
        transcriptionService: { finalizeSession },
      });
      const internals = internalsOf(manager);
      internals.currentSessionId = "session-1";
      internals.terminationCode = code;
      internals.audioChunks =
        code === "quick_release" ? [new Float32Array([0.1])] : [];
      internals.machine.__setStateForTesting({ tag: "STOP_C", code });
      const writeAudioFile = vi
        .spyOn(internals, "writeAudioFile")
        .mockResolvedValue(null);
      const pasteTranscription = vi
        .spyOn(internals, "pasteTranscription")
        .mockResolvedValue(undefined);
      const cancelled = vi.fn();
      manager.on("recording-cancelled", cancelled);

      await internals.handleFinalChunk("session-1");

      expect(cancelled).toHaveBeenCalledWith({
        sessionId: "session-1",
        code,
      });
      expect(cancelled).toHaveBeenCalledOnce();
      expect(writeAudioFile).not.toHaveBeenCalled();
      expect(finalizeSession).not.toHaveBeenCalled();
      expect(pasteTranscription).not.toHaveBeenCalled();
      expect(internals.audioChunks).toEqual([]);
      expect(manager.getState()).toBe("idle");
    },
  );

  it("I-37/I-43: USER_DISMISSED resets silently without pasting", async () => {
    // Finalize-phase dismiss (ESC after Stop): finalizeSession persists the
    // dismissed row and throws USER_DISMISSED. handleFinalChunk must reset
    // silently — no failure and no "no speech" toast, even for a long recording.
    const finalizeSession = vi
      .fn()
      .mockRejectedValue(
        new AppError("Recording dismissed", ErrorCodes.USER_DISMISSED),
      );
    const manager = createRecordingManager({
      transcriptionService: { finalizeSession },
    });
    const internals = internalsOf(manager);
    const pasteTranscription = vi
      .spyOn(internals, "pasteTranscription")
      .mockResolvedValue(undefined);

    const widgetNotifications: Array<{ type: string }> = [];
    manager.on("widget-notification", (n: { type: string }) => {
      widgetNotifications.push(n);
    });

    internals.currentSessionId = "s1";
    // Long enough that a genuine empty result would emit empty_transcript.
    internals.recordingStartedAt = 0;
    internals.recordingStoppedAt = 5000;
    internals.terminationCode = null;
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({ tag: "STOP_N" });

    await internals.handleFinalChunk("s1");

    expect(finalizeSession).toHaveBeenCalledTimes(1);
    expect(widgetNotifications).toEqual([]);
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(manager.getState()).toBe("idle");
  });

  it("includes the active microphone name in no-audio notifications", () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    const widgetNotifications: Array<{
      type: string;
      params?: Record<string, string>;
    }> = [];
    manager.on("widget-notification", (n) => {
      widgetNotifications.push(n);
    });

    internals.currentSessionId = "s1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    manager.setActiveMicrophoneForCurrentSession({
      sessionId: "s1",
      microphoneName: "External USB Mic",
      deviceId: "usb-mic",
      captureSource: "preferred",
    });

    internals.notifyNoAudio();

    expect(widgetNotifications).toEqual([
      {
        type: "no_audio",
        params: { microphone: "External USB Mic" },
      },
    ]);
  });

  it("I-43: an empty transcript notifies with the active microphone and never pastes", async () => {
    const finalizeSession = vi.fn().mockResolvedValue("");
    const manager = createRecordingManager({
      transcriptionService: { finalizeSession },
    });
    const internals = internalsOf(manager);
    const pasteTranscription = vi
      .spyOn(internals, "pasteTranscription")
      .mockResolvedValue(undefined);
    const widgetNotifications: Array<{
      type: string;
      params?: Record<string, string>;
    }> = [];
    manager.on("widget-notification", (n) => {
      widgetNotifications.push(n);
    });

    internals.currentSessionId = "s1";
    internals.audioChunks = [];
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
    manager.setActiveMicrophoneForCurrentSession({
      sessionId: "s1",
      microphoneName: "External USB Mic",
      deviceId: "usb-mic",
      captureSource: "preferred",
    });
    internals.machine.transition({ type: "signalStop" });
    internals.recordingStartedAt = 1000;
    internals.recordingStoppedAt = 6000;
    internals.terminationCode = null;
    internals.machine.resolvePendingStopSession();

    await internals.handleFinalChunk("s1");

    expect(finalizeSession).toHaveBeenCalledTimes(1);
    expect(pasteTranscription).not.toHaveBeenCalled();
    expect(widgetNotifications).toEqual([
      {
        type: "empty_transcript",
        params: { microphone: "External USB Mic" },
      },
    ]);
  });

  it("I-54 ignores active microphone reports from a retired session", () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    const widgetNotifications: Array<{
      type: string;
      params?: Record<string, string>;
    }> = [];
    manager.on("widget-notification", (n) => {
      widgetNotifications.push(n);
    });

    internals.currentSessionId = "replacement-session";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    manager.setActiveMicrophoneForCurrentSession({
      sessionId: "retired-session",
      microphoneName: "Stale Mic",
      deviceId: "stale",
      captureSource: "preferred",
    });

    internals.notifyNoAudio();

    expect(widgetNotifications).toEqual([
      { type: "no_audio", params: undefined },
    ]);
  });

  it("omits the microphone param when no active microphone was reported", () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    const widgetNotifications: Array<{
      type: string;
      params?: Record<string, string>;
    }> = [];
    manager.on("widget-notification", (n) => {
      widgetNotifications.push(n);
    });

    internals.currentSessionId = "s1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    // No setActiveMicrophoneForCurrentSession call → falls back to the generic
    // copy with no mic name.
    internals.notifyNoAudio();

    expect(widgetNotifications).toEqual([
      { type: "no_audio", params: undefined },
    ]);
  });
});
