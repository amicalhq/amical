import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { RecordingState } from "../../src/types/recording";
import { recordingRouter } from "../../src/trpc/routers/recording";

describe("recordingRouter capture lifecycle", () => {
  it("publishes the active session ID and delegates its capture failure", async () => {
    let state: RecordingState = "recording";
    const recordingManager = Object.assign(new EventEmitter(), {
      getState: vi.fn(() => state),
      getCurrentSessionId: vi.fn(() => "session-1"),
      getRecordingMode: vi.fn(() => "hands-free" as const),
      getIsDraftSession: vi.fn(() => false),
      handleCaptureStartFailure: vi.fn().mockResolvedValue(undefined),
    });
    const caller = recordingRouter.createCaller({
      services: { recordingManager },
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

    const failure = {
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    };
    await caller.captureStartFailed(failure);
    expect(recordingManager.handleCaptureStartFailure).toHaveBeenCalledWith(
      failure,
    );

    state = "idle";
    recordingManager.emit("state-changed", state);
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({ sessionId: null, state: "idle" }),
    );

    observer.unsubscribe();
  });
});
