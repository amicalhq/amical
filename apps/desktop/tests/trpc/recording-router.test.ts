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
      deviceId: "external-mic",
      captureSource: "preferred" as const,
    };
    await caller.captureStarted(microphone);
    expect(recordingLifecycle.captureStarted).toHaveBeenCalledWith(
      "session-1",
      { name: "External Mic", deviceId: "external-mic" },
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
});
