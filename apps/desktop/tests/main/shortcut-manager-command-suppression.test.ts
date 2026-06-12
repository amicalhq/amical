import { describe, expect, it } from "vitest";
import { createManager as createTestManager } from "./shortcut-manager-test-utils";

// Abstract keycodes. PTT ⊂ toggle (the default shape); paste/newNote disjoint.
const A = 101;
const B = 102;
const P1 = 110;
const P2 = 111;
const N1 = 120;
const N2 = 121;

const createManager = () => {
  const ctx = createTestManager();
  ctx.internals.shortcuts = {
    pushToTalk: [A, B],
    toggleRecording: [A, B, 103],
    pasteLastTranscript: [P1, P2],
    newNote: [N1, N2],
  };
  return ctx;
};

/**
 * The generic command kill-switch (used by the onboarding wizard): while
 * suppressed, ALL command emissions are dropped at the source; raw key-state
 * events always flow. PTT is masked rather than skipped, so a mid-hold
 * suppression flip still delivers a release.
 */
describe("ShortcutManager command suppression", () => {
  it("drops every command while suppressed and restores them when lifted", () => {
    const { manager, internals, timeline } = createManager();
    const fired: string[] = [];
    manager.on("paste-last-transcript-triggered", () => fired.push("paste"));
    manager.on("open-notes-window-triggered", () => fired.push("notes"));

    manager.setCommandsSuppressed(true);
    internals.addActiveKey(A);
    internals.addActiveKey(B);
    internals.removeActiveKey(B);
    internals.removeActiveKey(A);
    internals.addActiveKey(P1);
    internals.addActiveKey(P2);
    internals.removeActiveKey(P2);
    internals.removeActiveKey(P1);
    internals.addActiveKey(N1);
    internals.addActiveKey(N2);
    internals.removeActiveKey(N2);
    internals.removeActiveKey(N1);
    expect(timeline).toEqual([]);
    expect(fired).toEqual([]);

    manager.setCommandsSuppressed(false);
    internals.addActiveKey(A);
    internals.addActiveKey(B);
    internals.removeActiveKey(B);
    internals.removeActiveKey(A);
    internals.addActiveKey(P1);
    internals.addActiveKey(P2);
    internals.removeActiveKey(P2);
    internals.removeActiveKey(P1);
    internals.addActiveKey(N1);
    internals.addActiveKey(N2);
    expect(timeline).toEqual(["press", "release"]);
    expect(fired).toEqual(["paste", "notes"]);
  });

  it("delivers the PTT release when suppression begins mid-hold", () => {
    const { manager, internals, timeline } = createManager();

    internals.addActiveKey(A);
    internals.addActiveKey(B); // press while unsuppressed
    manager.setCommandsSuppressed(true); // e.g. a try-it step unmounted
    internals.removeActiveKey(B); // next key event must read as released

    expect(timeline).toEqual(["press", "release"]);
  });

  it("key-state events still flow while suppressed (shortcut screen needs them)", () => {
    const { manager, internals } = createManager();
    const keyStates: number[][] = [];
    manager.on("activeKeysChanged", (keys: number[]) => keyStates.push(keys));

    manager.setCommandsSuppressed(true);
    internals.addActiveKey(A);

    expect(keyStates).toEqual([[A]]);
  });

  it("does not fire a stale rising edge when suppression lifts mid-hold", () => {
    const { manager, internals } = createManager();
    const fired: string[] = [];
    manager.on("paste-last-transcript-triggered", () => fired.push("paste"));

    manager.setCommandsSuppressed(true);
    internals.addActiveKey(P1);
    internals.addActiveKey(P2); // exact match recorded while suppressed
    manager.setCommandsSuppressed(false);
    internals.removeActiveKey(P2); // edge already consumed — nothing fires
    internals.removeActiveKey(P1);

    expect(fired).toEqual([]);
  });
});
