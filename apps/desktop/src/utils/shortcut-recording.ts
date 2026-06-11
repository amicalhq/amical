/**
 * Pure state machine for shortcut recording's interpretation of active-key
 * emissions (see ShortcutInput).
 *
 * Keys can still be held when recording starts — most commonly the previous
 * chord's keys when the user saves a shortcut (saved on first release) and
 * immediately re-enters edit mode. Trusting that pre-held set would let its
 * releases shrink the set and complete the recording with a stale subset, so
 * the recorder stays UNARMED — ignoring all emissions — until it observes the
 * active set drain to empty. Only keys pressed after that count.
 *
 * Completion is terminal: tearing down the subscription after a completion is
 * async, so the rest of the chord's key-ups can still be delivered. Each one
 * shrinks the set and would otherwise complete again with a subset of the
 * chord just recorded, overwriting it.
 */
export interface ShortcutRecordingState {
  /** True once an empty active-key set has been seen since recording began. */
  armed: boolean;
  /** True once a release has completed the recording; later emissions are ignored. */
  completed: boolean;
  /** Keys currently held, as of the last emission (empty while unarmed). */
  activeKeys: number[];
}

export const initialShortcutRecordingState: ShortcutRecordingState = {
  armed: false,
  completed: false,
  activeKeys: [],
};

/**
 * Process one active-keys emission. Returns the next state, plus
 * `completedKeys` — the chord as held just before the first release — when a
 * shrinking set ends the recording.
 */
export function handleActiveKeysEmission(
  state: ShortcutRecordingState,
  keys: number[],
): { state: ShortcutRecordingState; completedKeys?: number[] } {
  if (state.completed) {
    return { state };
  }

  if (!state.armed) {
    return keys.length === 0
      ? { state: { armed: true, completed: false, activeKeys: [] } }
      : { state };
  }

  // A shrinking set means a key was released: the chord is complete.
  if (state.activeKeys.length > 0 && keys.length < state.activeKeys.length) {
    return {
      state: { armed: true, completed: true, activeKeys: keys },
      completedKeys: state.activeKeys,
    };
  }

  return { state: { armed: true, completed: false, activeKeys: keys } };
}
