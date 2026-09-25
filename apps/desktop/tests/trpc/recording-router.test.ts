import { afterEach, describe, expect, it, vi } from "vitest";
import { powerMonitor } from "electron";
import type { RecordingState } from "../../src/types/recording";
import { recordingRouter } from "../../src/trpc/routers/recording";
import * as trace from "../../src/main/telemetry/dictation-trace";
import {
  CaptureTimingsSchema,
  type CaptureTimingsBatch,
} from "../../src/types/capture-timings";

afterEach(() => vi.restoreAllMocks());

type FakeSnapshot = {
  sessionId: string | null;
  projection: {
    publicState: RecordingState;
    stopKind: "none";
    stopOrigin: "none";
    terminal: null;
  };
  metadata: { mode: "ptt" | "hands-free"; isDraft: boolean } | null;
};

const makeSnapshot = (
  state: RecordingState,
  sessionId: string | null,
  metadata: FakeSnapshot["metadata"],
): FakeSnapshot => ({
  sessionId,
  projection: {
    publicState: state,
    stopKind: "none",
    stopOrigin: "none",
    terminal: null,
  },
  metadata,
});

describe("recordingRouter capture lifecycle", () => {
  it("publishes system resume events and removes the listener on unsubscribe", async () => {
    const caller = recordingRouter.createCaller({ services: {} } as never);
    const next = vi.fn();
    const listenerCount = powerMonitor.listenerCount("resume");
    const subscription = (await caller.systemResume()).subscribe({ next });
    try {
      expect(powerMonitor.listenerCount("resume")).toBe(listenerCount + 1);
      expect(next).not.toHaveBeenCalled();
      powerMonitor.emit("unlock-screen");
      expect(next).not.toHaveBeenCalled();
      powerMonitor.emit("resume");
      powerMonitor.emit("resume");
      expect(next).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenLastCalledWith(null);
    } finally {
      subscription.unsubscribe();
    }
    expect(powerMonitor.listenerCount("resume")).toBe(listenerCount);
    powerMonitor.emit("resume");
    expect(next).toHaveBeenCalledTimes(2);
  });

  const timings = {
    phases: [
      {
        name: "capture.get-user-media" as const,
        startedAtMs: 1700000000005,
        durationMs: 80,
      },
    ],
    audioContext: {
      recoveryAttemptCount: 1,
      recoverySuccessCount: 1,
      recoveryFailureCount: 0,
      recoveryDurationMs: 80,
    },
  };

  it("records before readiness and settles capture timings only after the complete batch", async () => {
    const record = vi
      .spyOn(trace, "recordCapturePhases")
      .mockImplementation(() => {});
    const settle = vi
      .spyOn(trace, "settleObligation")
      .mockImplementation(() => {});
    const contextSummary = vi
      .spyOn(trace, "recordAudioContextTelemetry")
      .mockImplementation(() => {});
    const captureStarted = vi.fn();
    const caller = recordingRouter.createCaller({
      services: {
        recordingLifecycle: { captureStarted },
      },
    } as never);
    await caller.captureStarted({ sessionId: "one", timings });
    expect(record).toHaveBeenCalledWith("one", timings.phases);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(
      captureStarted.mock.invocationCallOrder[0],
    );
    expect(contextSummary).toHaveBeenCalledWith("one", timings.audioContext);
    expect(contextSummary.mock.invocationCallOrder[0]).toBeLessThan(
      captureStarted.mock.invocationCallOrder[0],
    );
    await caller.captureTimings({ sessionId: "one", timings, complete: false });
    expect(settle).not.toHaveBeenCalled();
    expect(contextSummary).toHaveBeenCalledTimes(2);
    await caller.captureTimings({ sessionId: "one", timings, complete: true });
    expect(record.mock.invocationCallOrder.at(-1)).toBeLessThan(
      settle.mock.invocationCallOrder[0],
    );
    expect(settle).toHaveBeenCalledWith("one", "capture.timings");
    expect(contextSummary).toHaveBeenCalledTimes(3);
    expect(contextSummary.mock.invocationCallOrder.at(-1)).toBeLessThan(
      settle.mock.invocationCallOrder[0],
    );
  });

  it("validates context summary counters, durations, and operation names", () => {
    expect(CaptureTimingsSchema.safeParse(timings).success).toBe(true);
    for (const invalid of [
      { recoveryAttemptCount: -1 },
      { recoveryAttemptCount: 0.5 },
      { recoverySuccessCount: -1 },
      { recoverySuccessCount: Infinity },
      { recoveryFailureCount: 0.5 },
      { recoveryFailureCount: NaN },
      { recoveryDurationMs: -1 },
      { recoveryDurationMs: Infinity },
      { recoveryDurationMs: NaN },
      { failureOperation: "unknown-operation" },
      { failureState: 123 },
    ]) {
      expect(
        CaptureTimingsSchema.safeParse({
          ...timings,
          audioContext: { ...timings.audioContext, ...invalid },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown phases and nonfinite times", async () => {
    const caller = recordingRouter.createCaller({ services: {} } as never);
    for (const invalid of [
      {
        ...timings,
        phases: [{ ...timings.phases[0], name: "arbitrary.span" }],
      },
      { ...timings, phases: [{ ...timings.phases[0], durationMs: Infinity }] },
    ]) {
      await expect(
        caller.captureTimings({
          sessionId: "one",
          timings: invalid as never,
          complete: true,
        }),
      ).rejects.toThrow();
    }
  });

  it("records completed capture steps before a later failure can close the trace", async () => {
    const record = vi
      .spyOn(trace, "recordCapturePhases")
      .mockImplementation(() => {});
    const contextSummary = vi
      .spyOn(trace, "recordAudioContextTelemetry")
      .mockImplementation(() => {});
    const captureFailed = vi.fn();
    const caller = recordingRouter.createCaller({
      services: {
        recordingLifecycle: { captureFailed },
      },
    } as never);
    const completed: CaptureTimingsBatch = {
      phases: [
        { ...timings.phases[0], name: "capture.enumerate-devices" as const },
      ],
      audioContext: {
        ...timings.audioContext,
        recoverySuccessCount: 0,
        recoveryFailureCount: 1,
        failureOperation: "recover",
        failureState: "suspended",
      },
    };
    await caller.captureFailed({
      sessionId: "failed",
      message: "permission denied",
      timings: completed,
    });
    expect(record).toHaveBeenCalledWith("failed", completed.phases);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(
      captureFailed.mock.invocationCallOrder[0],
    );
    expect(contextSummary).toHaveBeenCalledWith(
      "failed",
      completed.audioContext,
    );
    expect(contextSummary.mock.invocationCallOrder[0]).toBeLessThan(
      captureFailed.mock.invocationCallOrder[0],
    );
  });

  it("I-51 forwards dismiss and signalStop to their distinct lifecycle methods", async () => {
    const stopDictation = vi.fn().mockResolvedValue(undefined);
    const dismiss = vi.fn().mockResolvedValue(undefined);
    const caller = recordingRouter.createCaller({
      services: {
        recordingLifecycle: { stopDictation, dismiss },
      },
    } as never);

    await caller.dismiss();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(stopDictation).not.toHaveBeenCalled();

    await caller.signalStop();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(stopDictation).toHaveBeenCalledOnce();
  });

  it("I-55 publishes the active session ID and delegates its capture failure", async () => {
    const snapshotListeners = new Set<(snapshot: FakeSnapshot) => void>();
    let snapshot = makeSnapshot("recording", "session-1", {
      mode: "hands-free",
      isDraft: false,
    });
    const recordingLifecycle = {
      getSnapshot: vi.fn(() => snapshot),
      onSnapshot: vi.fn((listener: (snapshot: FakeSnapshot) => void) => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      }),
      onNotification: vi.fn(() => () => undefined),
      onDraftChanged: vi.fn(() => () => undefined),
      getPendingDraft: vi.fn(() => null),
      startDictation: vi.fn().mockResolvedValue(undefined),
      stopDictation: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn().mockResolvedValue(undefined),
      confirmDraft: vi.fn().mockResolvedValue(undefined),
      dismissDraft: vi.fn(),
      captureStarted: vi.fn(),
      captureFailed: vi.fn(),
    };
    const caller = recordingRouter.createCaller({
      services: { recordingLifecycle },
    } as never);
    const updates: Array<{ sessionId: string | null; state: RecordingState }> =
      [];
    const subscription = await caller.stateUpdates();
    const observer = subscription.subscribe({
      next: (update) => updates.push(update),
    });

    expect(updates).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        state: "recording",
      }),
    ]);

    const microphone = {
      sessionId: "session-1",
      microphoneName: "External Mic",
      captureSource: "preferred" as const,
    };
    await caller.captureStarted(microphone);
    expect(recordingLifecycle.captureStarted).toHaveBeenCalledWith(
      "session-1",
      { name: "External Mic" },
    );

    const failure = {
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    };
    await caller.captureFailed(failure);
    expect(recordingLifecycle.captureFailed).toHaveBeenCalledWith(
      "session-1",
      failure,
    );

    snapshot = makeSnapshot("idle", null, null);
    for (const listener of snapshotListeners) listener(snapshot);
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({ sessionId: null, state: "idle" }),
    );

    observer.unsubscribe();
  });

  it("suppresses the recording-saved sub-line when the failure sealed before recording", async () => {
    type NotificationListener = (data: {
      type: "transcription_failed";
      errorCode: string;
      noRecording: boolean;
    }) => void;
    const notificationListeners = new Set<NotificationListener>();
    const recordingLifecycle = {
      onNotification: vi.fn((listener: NotificationListener) => {
        notificationListeners.add(listener);
        return () => notificationListeners.delete(listener);
      }),
    };
    const caller = recordingRouter.createCaller({
      services: { recordingLifecycle },
    } as never);
    const emitted: Array<{ subDescription?: unknown }> = [];
    const subscription = await caller.widgetNotifications();
    const observer = subscription.subscribe({
      next: (notification) => emitted.push(notification),
    });

    const failure = {
      type: "transcription_failed" as const,
      errorCode: "WORKER_INITIALIZATION_FAILED",
    };
    for (const listener of notificationListeners)
      listener({ ...failure, noRecording: true });
    for (const listener of notificationListeners)
      listener({ ...failure, noRecording: false });

    expect(emitted).toHaveLength(2);
    expect(emitted[0].subDescription).toBeUndefined();
    expect(emitted[1].subDescription).toEqual({
      key: "widget.notifications.recordingSaved",
    });

    observer.unsubscribe();
  });
});
