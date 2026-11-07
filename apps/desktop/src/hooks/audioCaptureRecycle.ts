const ONE_MINUTE_MS = 60_000;

export const AUDIO_CONTEXT_IDLE_TIMEOUT_MS = 60 * ONE_MINUTE_MS;
export const AUDIO_CONTEXT_RECYCLE_AGE_MS = 7 * ONE_MINUTE_MS;
const MIN_RECORDING_ATTEMPT_MS = 5_000;

/** Age recycling is evaluated after capture cleanup, never by an age timer. */
export const shouldRecycleAudioContext = (
  contextAgeMs: number,
  attemptDurationMs: number,
): boolean =>
  contextAgeMs > AUDIO_CONTEXT_RECYCLE_AGE_MS &&
  attemptDurationMs > MIN_RECORDING_ATTEMPT_MS;
