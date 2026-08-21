import { describe, expect, it, vi } from "vitest";
import type { RecordingState } from "../../src/types/recording";
import { recordingRouter } from "../../src/trpc/routers/recording";

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
      captureStartFailed: vi.fn(),
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
    await caller.captureStartFailed(failure);
    expect(recordingLifecycle.captureStartFailed).toHaveBeenCalledWith(
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
