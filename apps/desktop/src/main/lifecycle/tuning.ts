import type { BoundStage } from "./types";

/**
 * Tuning table — every duration the lifecycle stack reads, in one place.
 * Stage bounds implement the one-bound-per-stage shell rule; the rest are
 * port/grammar/surface obligations. Values carried from the v1 constants
 * where an equivalent existed.
 */
export interface LifecycleTuning {
  /** Stage bounds, armed and cancelled by the shell on stage transitions. */
  stageBoundsMs: Record<BoundStage, number>;
  /** RecorderPort: wall clock from recorderReady to noAudioDetected. */
  deadMicMs: number;
  /** RecorderPort: stop-drain wait for the renderer's final chunk before
   * recorderClosed is reported with whatever custody holds. Must sit well
   * under the resolving stage bound so finalize still has room. */
  drainMs: number;
  /** Grammar: press window (quickness is decided by event order against it). */
  pressWindowMs: number;
  /** Grammar: re-press window after a quick release before it becomes a discard. */
  quickWindowMs: number;
  /** Surface: "recording is getting long" reminder, off the recording projection. */
  longRecordingReminderMs: number;
}

export const DEFAULT_LIFECYCLE_TUNING: LifecycleTuning = {
  stageBoundsMs: {
    starting: 10_000, // v1 had no start bound; matches the stop-recovery order
    recording: 6 * 60 * 1000, // v1 RECORDING_MAX_DURATION
    resolving: 10_000, // v1 RECORDING_STOP_RECOVERY_TIMEOUT
    committing: 3_000, // R7 commit grace: local write, then degrade + repair
    staging: 5_000, // paste/draft staging incl. the 2.5s draft capture barrier
  },
  deadMicMs: 5_000, // v1 NO_AUDIO_TIMEOUT
  drainMs: 3_000, // v1 folded this into the 10s stop recovery wait
  pressWindowMs: 500, // v1 QUICK_PRESS_THRESHOLD
  quickWindowMs: 500,
  longRecordingReminderMs: 5 * 60 * 1000, // v1 RECORDING_WARNING_TIMEOUT
};
