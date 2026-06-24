// Timing policy for recycling the warm AudioContext between dictations.
// Kept in its own module so the (subtle) delay math can be unit-tested without
// standing up the full React hook + Web Audio environment.

const ONE_MINUTE_MS = 60_000;

// Keep the (suspended) AudioContext warm between dictations for fast restarts,
// then release the hardware context after this long with no new dictation.
export const AUDIO_CONTEXT_IDLE_TIMEOUT_MS = 5 * ONE_MINUTE_MS;

// Recycle the AudioContext once it has been alive this long, so a long-lived
// session doesn't ride one context across device changes / sleep-wake drift.
export const AUDIO_CONTEXT_MAX_AGE_MS = 7 * ONE_MINUTE_MS;

// Delay before recycling an idle, warm AudioContext: the idle window, but capped
// so the context never outlives its max age. Clamped at 0 so an already-too-old
// context recycles immediately instead of scheduling a negative timeout.
export const computeIdleRecycleDelayMs = (contextAgeMs: number): number =>
  Math.min(
    AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
    Math.max(AUDIO_CONTEXT_MAX_AGE_MS - contextAgeMs, 0),
  );
