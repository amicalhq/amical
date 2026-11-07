import { describe, expect, it } from "vitest";
import {
  BLACKMAN_POWER_DB,
  VOICE_HIGH_HZ,
  VOICE_LOW_HZ,
  createVoiceLevelMeter,
} from "@/hooks/voiceLevelMeter";

const BIN_HZ = 16_000 / 512;
const FRAME_S = 512 / 16_000;
const VOICE_BINS =
  Math.round(VOICE_HIGH_HZ / BIN_HZ) - Math.round(VOICE_LOW_HZ / BIN_HZ);

// AnalyserNode-style bins whose voice-band power is `bandDbfs`.
const bins = (bandDbfs: number) =>
  new Float32Array(256).fill(
    bandDbfs - BLACKMAN_POWER_DB - 10 * Math.log10(VOICE_BINS),
  );

const feed = (
  meter: ReturnType<typeof createVoiceLevelMeter>,
  frame: Float32Array,
  seconds: number,
) => {
  let level = 0;
  for (let t = 0; t < seconds; t += FRAME_S) level = meter(frame, FRAME_S);
  return level;
};

describe("createVoiceLevelMeter", () => {
  it("reads room noise as silence and keeps loud speech below full scale", () => {
    const meter = createVoiceLevelMeter(16_000);
    expect(feed(meter, bins(-58), 1)).toBe(0);
    const speech = meter(bins(-34), FRAME_S);
    const loud = meter(bins(-20), FRAME_S);
    expect(speech).toBeGreaterThan(0.6);
    expect(loud).toBeGreaterThan(speech);
    expect(loud).toBeLessThan(0.95);
  });

  it("learns steady background noise as the new silence", () => {
    const meter = createVoiceLevelMeter(16_000);
    expect(meter(bins(-44), FRAME_S)).toBeGreaterThan(0.2);
    expect(feed(meter, bins(-44), 10)).toBe(0);
  });

  it("does not let digital silence pull the floor down", () => {
    const meter = createVoiceLevelMeter(16_000);
    expect(feed(meter, new Float32Array(256).fill(-Infinity), 1)).toBe(0);
    expect(meter(bins(-58), FRAME_S)).toBe(0);
  });
});
