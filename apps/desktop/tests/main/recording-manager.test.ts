import { describe, expect, it, vi } from "vitest";
import { RecordingManager } from "../../src/main/managers/recording-manager";
import { RecordingMachineInterpreter } from "../../src/main/managers/recording-machine-interpreter";
import type { ServiceManager } from "../../src/main/managers/service-manager";
import type { RecordingState } from "../../src/types/recording";
import type {
  ActiveRecordingMode,
  TerminationCode,
} from "../../src/main/managers/recording-state-machine";

type RecordingManagerInternals = {
  machine: RecordingMachineInterpreter;
  currentSessionId: string | null;
  terminationCode: TerminationCode | null;
  recordingStartedAt: number | null;
  systemAudioMuted: boolean;
  soundsMuted: boolean;
  performStartSession(mode: ActiveRecordingMode): Promise<void>;
  performEndRecording(code?: TerminationCode | null): Promise<void>;
  handleFinalChunk(): Promise<void>;
  forceIdle(): Promise<void>;
};

const createRecordingManager = (
  services: Record<string, unknown> = {},
): RecordingManager =>
  new RecordingManager({
    getService: vi.fn((serviceName: string) => services[serviceName]),
  } as unknown as ServiceManager);

const internalsOf = (manager: RecordingManager): RecordingManagerInternals =>
  manager as unknown as RecordingManagerInternals;

describe("recording manager FSM interpreter", () => {
  it("sets stop intent before broadcasting stopping", () => {
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

  it("waits for a pending stop command before finalizing a final chunk", async () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    internals.currentSessionId = "session-1";
    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    internals.machine.transition({ type: "pttPress", quick: true });

    let finalized = false;
    const finalization = internals.handleFinalChunk().then(() => {
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

  it("resolves an existing pending stop before replacing it", async () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);

    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    internals.machine.transition({ type: "noAudioTimeout" });
    const oldPendingStop = internals.machine.currentPendingStopSession;
    expect(oldPendingStop).not.toBeNull();

    let oldResolved = false;
    oldPendingStop!.promise.then(() => {
      oldResolved = true;
    });

    internals.machine.__setStateForTesting({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    internals.machine.transition({ type: "noAudioTimeout" });
    await Promise.resolve();

    expect(oldResolved).toBe(true);
    expect(internals.machine.currentPendingStopSession).not.toBe(
      oldPendingStop,
    );
    expect(internals.terminationCode).toBe("no_audio");
  });

  it("finalizes interrupted starts without waiting for a renderer final chunk", async () => {
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
      tag: "STARTING",
      mode: "hands-free",
    });

    const cancelled = vi.fn();
    manager.on("recording-cancelled", cancelled);

    const commands = internals.machine.transition({ type: "signalStop" });
    expect(commands).toEqual([
      { type: "stopSession", code: "interrupted_start" },
    ]);

    await internals.performEndRecording("interrupted_start");

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
    expect(internals.machine.currentPendingStopSession).toBeNull();
    expect(manager.getState()).toBe("idle");
  });

  it("cleanup during STARTING completes native start before tearing down", async () => {
    const modelService = {
      getSelectedModel: vi.fn().mockResolvedValue({ id: "model-1" }),
    };
    const transcriptionService = {
      resetVadForNewSession: vi.fn().mockResolvedValue(undefined),
      warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
      cancelStreamingSession: vi.fn().mockResolvedValue(undefined),
    };
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn(),
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
    expect(manager.getState()).toBe("idle");
  });

  it("does not overwrite recordingStartedAt when start is already stopping", async () => {
    const transcriptionService = {
      resetVadForNewSession: vi.fn().mockResolvedValue(undefined),
      warmupActiveProvider: vi.fn().mockResolvedValue(undefined),
    };
    const nativeBridge = {
      refreshAccessibilityContext: vi.fn(),
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

  it("aborts a start that reaches the interpreter without a session id", async () => {
    const manager = createRecordingManager();
    const internals = internalsOf(manager);
    internals.currentSessionId = null;
    internals.machine.__setStateForTesting({
      tag: "STARTING",
      mode: "hands-free",
    });

    await internals.performStartSession("hands-free");

    expect(internals.currentSessionId).toBeNull();
    expect(internals.recordingStartedAt).toBeNull();
    expect(internals.machine.currentState).toEqual({ tag: "IDLE" });
  });

  it("times out instead of waiting forever for a pending stop command", async () => {
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

      const finalization = internals.handleFinalChunk();
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

  it("cleanup force-stops native capture before resetting a timed-out pending stop", async () => {
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

  it("cleanup force-stops when native stop resolved but final chunk never arrived", async () => {
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
});
