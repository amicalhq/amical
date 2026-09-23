import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCaptureTimings } from "../../src/hooks/audioCaptureTimings";
import { createOrResumeAudioContext } from "../../src/hooks/audioCaptureContext";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("capture timings", () => {
  it.each([false, true])(
    "preserves a worklet load failure after cleanup; close failure=%s",
    async (closeFails) => {
      const failure = new Error("worklet load failed");
      const close = vi.fn(async () => {
        if (closeFails) throw new Error("context close failed");
      });
      vi.stubGlobal(
        "AudioContext",
        class {
          audioWorklet = {
            addModule: async () => {
              throw failure;
            },
          };
          close = close;
        },
      );
      const timings = new AudioCaptureTimings();
      await expect(
        createOrResumeAudioContext({
          currentAudioContext: null,
          sampleRate: 16000,
          audioWorkletUrl: "test-worklet",
          timings,
        }),
      ).rejects.toBe(failure);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("records epoch starts and local monotonic durations", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const timings = new AudioCaptureTimings();
    const finish = timings.start("capture.audio-context-create");
    now.mockReturnValue(140);
    finish();
    expect(timings.takeBatch()).toEqual({
      phases: [
        {
          name: "capture.audio-context-create",
          startedAtMs: 1700000000000,
          durationMs: 40,
        },
      ],
    });
    expect(timings.takeBatch().phases).toEqual([]);
  });

  it("propagates the original failure without recording a duration", async () => {
    const timings = new AudioCaptureTimings();
    const failure = new Error("permission denied");
    await expect(
      timings.measure("capture.get-user-media", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(timings.takeBatch()).toEqual({ phases: [] });
  });

  it("keeps timing batches isolated between captures", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(10);
    const wall = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const first = new AudioCaptureTimings();
    first.startFirstFrameWait();
    now.mockReturnValue(35);
    wall.mockReturnValue(1700000000025);
    const next = new AudioCaptureTimings();
    const finishNext = next.start("capture.audio-context-create");
    first.finishFirstFrameWait();
    now.mockReturnValue(40);
    finishNext();
    expect(first.takeBatch().phases).toEqual([
      {
        name: "capture.first-frame-wait",
        startedAtMs: 1700000000000,
        durationMs: 25,
      },
    ]);
    expect(next.takeBatch().phases).toEqual([
      {
        name: "capture.audio-context-create",
        startedAtMs: 1700000000025,
        durationMs: 5,
      },
    ]);
  });
});
