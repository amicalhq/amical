import { describe, it, expect } from "vitest";
import {
  AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
  AUDIO_CONTEXT_RECYCLE_AGE_MS,
  shouldRecycleAudioContext,
} from "@/hooks/audioCaptureRecycle";

describe("audio context retention policy", () => {
  it("retains an idle context for one hour", () => {
    expect(AUDIO_CONTEXT_IDLE_TIMEOUT_MS).toBe(60 * 60_000);
  });

  it.each([
    [AUDIO_CONTEXT_RECYCLE_AGE_MS, 5_001, false],
    [AUDIO_CONTEXT_RECYCLE_AGE_MS + 1, 5_000, false],
    [AUDIO_CONTEXT_RECYCLE_AGE_MS + 1, 5_001, true],
    [60 * 60_000, 500, false],
    [60_000, 10_000, false],
  ])(
    "checks age %i ms and attempt duration %i ms together",
    (age, duration, expected) => {
      expect(shouldRecycleAudioContext(age, duration)).toBe(expected);
    },
  );
});
