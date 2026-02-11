/**
 * VAD configuration for speech extraction with hysteresis
 */
interface VadConfig {
  /** Samples per frame (default: 512 for 32ms at 16kHz) */
  frameSize: number;
  /** Score threshold to START speech detection */
  startThreshold: number;
  /** Score threshold to END speech detection */
  endThreshold: number;
  /** Consecutive frames above startThreshold to confirm speech start */
  startFrames: number;
  /** Consecutive silence frames before ending speech (hangover) */
  endSilenceFrames: number;
  /** Frames to keep before speech start */
  preRollFrames: number;
  /** Frames to keep after speech end */
  postRollFrames: number;
  /** Minimum speech segment duration in frames to accept */
  minSpeechFrames: number;
}

/**
 * Default VAD configuration (sensitive preset - picks up quieter speech)
 */
export const DEFAULT_VAD_CONFIG: VadConfig = {
  frameSize: 512,
  startThreshold: 0.3,
  endThreshold: 0.1,
  startFrames: 2,
  endSilenceFrames: 20, // ~640ms at 32ms/frame
  preRollFrames: 15, // ~480ms at 32ms/frame
  postRollFrames: 6, // ~192ms at 32ms/frame
  minSpeechFrames: 3, // ~96ms at 32ms/frame
};

interface SpeechSegment {
  start: number;
  end: number;
}

export interface SpeechExtractionResult {
  audio: Float32Array;
  segments: SpeechSegment[];
}

/**
 * Extracts speech segments from audio based on VAD probabilities using hysteresis.
 *
 * Uses a state machine with two thresholds:
 * - startThreshold: Higher threshold to START speech (reduces false triggers)
 * - endThreshold: Lower threshold to END speech (allows brief dips)
 *
 * Also includes pre-roll, post-roll, hangover, and minimum duration filtering.
 */
export function extractSpeechFromVad(
  audioData: Float32Array,
  vadProbs: number[],
  config: VadConfig = DEFAULT_VAD_CONFIG,
): SpeechExtractionResult {
  const {
    frameSize,
    startThreshold,
    endThreshold,
    startFrames,
    endSilenceFrames,
    preRollFrames,
    postRollFrames,
    minSpeechFrames,
  } = config;

  // State machine
  type State = "SILENCE" | "IN_SPEECH";
  let state: State = "SILENCE";
  let consecutiveSpeechFrames = 0;
  let consecutiveSilenceFrames = 0;
  let speechStartFrame = 0;

  const segments: SpeechSegment[] = [];

  for (let i = 0; i < vadProbs.length; i++) {
    const prob = vadProbs[i] ?? 0;

    if (state === "SILENCE") {
      if (prob >= startThreshold) {
        consecutiveSpeechFrames++;
        if (consecutiveSpeechFrames >= startFrames) {
          state = "IN_SPEECH";
          speechStartFrame = Math.max(
            0,
            i - consecutiveSpeechFrames - preRollFrames + 1,
          );
          consecutiveSilenceFrames = 0;
        }
      } else {
        consecutiveSpeechFrames = 0;
      }
    } else {
      // IN_SPEECH
      if (prob < endThreshold) {
        consecutiveSilenceFrames++;
        if (consecutiveSilenceFrames >= endSilenceFrames) {
          const speechEndFrame = Math.min(
            vadProbs.length - 1,
            i + postRollFrames,
          );
          const segmentLengthFrames = speechEndFrame - speechStartFrame + 1;

          if (segmentLengthFrames >= minSpeechFrames) {
            segments.push({ start: speechStartFrame, end: speechEndFrame });
          }

          state = "SILENCE";
          consecutiveSpeechFrames = 0;
          consecutiveSilenceFrames = 0;
        }
      } else {
        consecutiveSilenceFrames = 0;
      }
    }
  }

  // Handle case where audio ends while still in speech
  if (state === "IN_SPEECH") {
    const speechEndFrame = vadProbs.length - 1;
    const segmentLengthFrames = speechEndFrame - speechStartFrame + 1;
    if (segmentLengthFrames >= minSpeechFrames) {
      segments.push({ start: speechStartFrame, end: speechEndFrame });
    }
  }

  // Merge overlapping or adjacent segments
  const mergedSegments: SpeechSegment[] = [];
  for (const segment of segments) {
    const last = mergedSegments[mergedSegments.length - 1];
    if (last && segment.start <= last.end) {
      last.end = Math.max(last.end, segment.end);
    } else {
      mergedSegments.push({ ...segment });
    }
  }

  // Extract audio samples for all segments
  let totalSamples = 0;
  for (const segment of mergedSegments) {
    const startSample = segment.start * frameSize;
    const endSample = Math.min((segment.end + 1) * frameSize, audioData.length);
    totalSamples += endSample - startSample;
  }

  const speechAudio = new Float32Array(totalSamples);
  let offset = 0;
  for (const segment of mergedSegments) {
    const startSample = segment.start * frameSize;
    const endSample = Math.min((segment.end + 1) * frameSize, audioData.length);
    speechAudio.set(audioData.subarray(startSample, endSample), offset);
    offset += endSample - startSample;
  }

  return { audio: speechAudio, segments: mergedSegments };
}
