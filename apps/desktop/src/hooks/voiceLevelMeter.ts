export const VOICE_LOW_HZ = 125;
export const VOICE_HIGH_HZ = 1900;
// AnalyserNode bins are |X|/N of a Blackman-windowed FFT. Adding
// 10·log10(2 / 0.3046) converts their summed power to dBFS. This holds only
// for unsmoothed bins (smoothingTimeConstant = 0).
export const BLACKMAN_POWER_DB = 8.17;
// The rate the meter is tuned for: FFT_SIZE is a 32 ms window here, the
// length of one worklet frame.
export const VOICE_LEVEL_SAMPLE_RATE = 16_000;
const FFT_SIZE = 512;
// Typical room noise in the voice band; the floor adapts from here.
const FLOOR_PRIOR_DB = -56;
// Below this is digital silence (stream start, mic warm-up), not room noise.
const DIGITAL_SILENCE_DB = -85;
const FLOOR_MAX_DB = -35;
const FLOOR_FALL_S = 0.08;
const FLOOR_RISE_S = 4;
const FLOOR_MAX_RISE_DB_PER_S = 1.5;
const MARGIN_DB = 6;
const KNEE_DB = 24;
const KNEE = 1.6;

export type VoiceLevelMeter = ReturnType<typeof createVoiceLevelMeter>;

/**
 * Returns a meter that maps AnalyserNode bins (dB) to a voice level in 0..1,
 * measured above an adaptive room-noise floor. The floor falls fast into gaps
 * between words and rises slowly, so steady room noise reads as silence. A
 * soft knee lets soft and loud voices both use most of the range without
 * pinning at the top. Reuse one meter across dictations to keep the floor.
 */
export function createVoiceLevelMeter(sampleRate: number) {
  const binHz = sampleRate / FFT_SIZE;
  const low = Math.round(VOICE_LOW_HZ / binHz);
  const high = Math.round(VOICE_HIGH_HZ / binHz);
  let floorDb = FLOOR_PRIOR_DB;

  return (binDb: Float32Array, dtSeconds: number): number => {
    let power = 0;
    for (let k = low; k < high; k++) power += 10 ** (binDb[k] / 10);
    const db = 10 * Math.log10(power) + BLACKMAN_POWER_DB;

    if (db < DIGITAL_SILENCE_DB) {
      // Keep the floor.
    } else if (db < floorDb) {
      floorDb = db + (floorDb - db) * Math.exp(-dtSeconds / FLOOR_FALL_S);
    } else {
      const rise = (db - floorDb) * (1 - Math.exp(-dtSeconds / FLOOR_RISE_S));
      floorDb = Math.min(
        FLOOR_MAX_DB,
        floorDb + Math.min(rise, FLOOR_MAX_RISE_DB_PER_S * dtSeconds),
      );
    }

    const aboveFloor = Math.max(0, db - floorDb - MARGIN_DB) / KNEE_DB;
    return 1 - Math.exp(-KNEE * aboveFloor);
  };
}

export type VoiceLevelTap = ReturnType<typeof createVoiceLevelTap>;

/**
 * A passive analyser branch on `source` that feeds `measure`. Each read
 * measures the analyser's latest window; the caller's read cadence (worklet
 * frames, animation frames) only sets `dtSeconds`.
 */
export function createVoiceLevelTap(
  audioContext: BaseAudioContext,
  source: AudioNode,
  measure: VoiceLevelMeter,
) {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const binDb = new Float32Array(analyser.frequencyBinCount);

  return {
    read(dtSeconds: number): number {
      analyser.getFloatFrequencyData(binDb);
      return measure(binDb, dtSeconds);
    },
    disconnect() {
      analyser.disconnect();
    },
  };
}
