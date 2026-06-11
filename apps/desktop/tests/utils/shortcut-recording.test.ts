import { describe, expect, it } from "vitest";
import {
  handleActiveKeysEmission,
  initialShortcutRecordingState,
  type ShortcutRecordingState,
} from "../../src/utils/shortcut-recording";

const SHIFT = 56;
const A = 0;
const S = 1;

// Feed a sequence of emissions through the reducer, collecting completions.
const run = (emissions: number[][]) => {
  let state: ShortcutRecordingState = initialShortcutRecordingState;
  const completions: number[][] = [];
  for (const keys of emissions) {
    const result = handleActiveKeysEmission(state, keys);
    state = result.state;
    if (result.completedKeys) {
      completions.push(result.completedKeys);
    }
  }
  return { state, completions };
};

describe("handleActiveKeysEmission", () => {
  it("captures a chord and completes it on the first release", () => {
    const { completions } = run([
      [], // initial emit: nothing held → armed
      [SHIFT],
      [SHIFT, A],
      [SHIFT, A, S],
      [SHIFT, A], // first release ends the recording
    ]);
    expect(completions).toEqual([[SHIFT, A, S]]);
  });

  it("ignores keys still held from the previous chord (bug repro)", () => {
    // Record Shift+A+S, save on first release, immediately re-edit while
    // Shift+S are still physically held: their releases must NOT complete
    // the new recording with a subset of the old chord.
    const { state, completions } = run([
      [SHIFT, S], // initial emit: leftovers from the previous chord
      [SHIFT], // releasing S must not save "Shift+S"
      [], // releasing Shift must not save "Shift" — now armed
    ]);
    expect(completions).toEqual([]);
    expect(state.armed).toBe(true);
  });

  it("records a fresh chord normally after draining leftover keys", () => {
    const { completions } = run([
      [SHIFT, S], // leftovers
      [SHIFT],
      [], // armed
      [SHIFT],
      [SHIFT, A],
      [SHIFT], // release completes the new chord
    ]);
    expect(completions).toEqual([[SHIFT, A]]);
  });

  it("does not arm while leftover keys are still partially held", () => {
    const { state } = run([[SHIFT, S], [SHIFT]]);
    expect(state.armed).toBe(false);
    expect(state.activeKeys).toEqual([]);
  });

  it("arms immediately when the initial emit is empty", () => {
    const { state } = run([[]]);
    expect(state.armed).toBe(true);
  });

  it("does not complete on a growing or unchanged set", () => {
    const { completions } = run([[], [SHIFT], [SHIFT, A], [SHIFT, A]]);
    expect(completions).toEqual([]);
  });

  it("completes at most once — later releases racing the unsubscribe are ignored", () => {
    // The first release completes the recording, but tearing down the
    // subscription is async: the rest of the chord's key-ups can still be
    // delivered. They must not complete again with a shrinking subset.
    const { completions } = run([
      [],
      [SHIFT, A, S],
      [SHIFT, A], // completes with Shift+A+S
      [SHIFT], // must not complete with Shift+A
      [], // must not complete with Shift
    ]);
    expect(completions).toEqual([[SHIFT, A, S]]);
  });
});
