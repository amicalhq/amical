import { describe, it, expect } from "vitest";
import {
  AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
  AUDIO_CONTEXT_MAX_AGE_MS,
  computeIdleRecycleDelayMs,
} from "@/hooks/audioCaptureRecycle";

const MIN = 60_000;

describe("computeIdleRecycleDelayMs", () => {
  it("documents idle (5min) < max-age (7min) so the max-age cap actually binds", () => {
    // Regression guard: when these were equal, the max-age cap was dead code and
    // the idle countdown was silently shortened by the context's pre-idle age.
    expect(AUDIO_CONTEXT_IDLE_TIMEOUT_MS).toBe(5 * MIN);
    expect(AUDIO_CONTEXT_MAX_AGE_MS).toBe(7 * MIN);
    expect(AUDIO_CONTEXT_IDLE_TIMEOUT_MS).toBeLessThan(
      AUDIO_CONTEXT_MAX_AGE_MS,
    );
  });

  it("uses the full idle timeout for a freshly-created context", () => {
    expect(computeIdleRecycleDelayMs(0)).toBe(AUDIO_CONTEXT_IDLE_TIMEOUT_MS);
  });

  it("keeps the full idle window while the context is younger than (maxAge - idle)", () => {
    // remaining max-age (6min, 5min) is >= idle (5min), so idle wins.
    expect(computeIdleRecycleDelayMs(1 * MIN)).toBe(
      AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
    );
    expect(computeIdleRecycleDelayMs(2 * MIN)).toBe(
      AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
    );
  });

  it("caps the delay at the remaining max age once the context is old enough", () => {
    // age 3min -> remaining max-age 4min < 5min idle, so the cap shortens it.
    expect(computeIdleRecycleDelayMs(3 * MIN)).toBe(4 * MIN);
    expect(computeIdleRecycleDelayMs(6 * MIN)).toBe(1 * MIN);
  });

  it("recycles immediately (0) when the context is already at or past max age", () => {
    expect(computeIdleRecycleDelayMs(AUDIO_CONTEXT_MAX_AGE_MS)).toBe(0);
    expect(computeIdleRecycleDelayMs(AUDIO_CONTEXT_MAX_AGE_MS + 30 * MIN)).toBe(
      0,
    );
  });

  it("never returns a negative delay and never exceeds the idle timeout", () => {
    for (const age of [0, MIN, 2 * MIN, 5 * MIN, 7 * MIN, 100 * MIN]) {
      const delay = computeIdleRecycleDelayMs(age);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(AUDIO_CONTEXT_IDLE_TIMEOUT_MS);
    }
  });
});
