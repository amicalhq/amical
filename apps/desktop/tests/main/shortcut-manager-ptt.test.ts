import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";

// Abstract keycodes for the test. PTT is a strict subset of toggle (the default
// shape: Ctrl+Win ⊂ Ctrl+Win+Space, Fn ⊂ Fn+Space).
const A = 101;
const B = 102;
const C = 103;
const UNRELATED = 200;

type ShortcutManagerInternals = {
  shortcuts: {
    pushToTalk: number[];
    toggleRecording: number[];
    pasteLastTranscript: number[];
    newNote: number[];
  };
  addActiveKey(keyCode: number): void;
  removeActiveKey(keyCode: number): void;
};

const createManager = () => {
  const manager = new ShortcutManager(
    {} as never,
    new EventEmitter() as never,
  );
  const internals = manager as unknown as ShortcutManagerInternals;
  internals.shortcuts = {
    pushToTalk: [A, B],
    toggleRecording: [A, B, C],
    pasteLastTranscript: [],
    newNote: [],
  };

  // Mirror how recording-manager consumes the events: PTT is edge-detected
  // (act only on changes), toggle fires directly. The resulting timeline is the
  // exact sequence of events that would drive the recording FSM.
  const timeline: string[] = [];
  let lastPtt = false;
  manager.on("ptt-state-changed", (pressed: boolean) => {
    if (pressed !== lastPtt) {
      lastPtt = pressed;
      timeline.push(pressed ? "press" : "release");
    }
  });
  manager.on("toggle-recording-triggered", () => timeline.push("toggle"));

  return { internals, timeline };
};

describe("ShortcutManager PTT activation (exact start, subset hold)", () => {
  it("upgrades PTT→toggle and survives releasing the extra key first", () => {
    const { internals, timeline } = createManager();

    internals.addActiveKey(A); // {A}        — not yet PTT
    internals.addActiveKey(B); // {A,B}      — exact → PTT press
    internals.addActiveKey(C); // {A,B,C}    — toggle; PTT stays held (subset)
    internals.removeActiveKey(C); // {A,B}   — PTT stays held; no phantom press
    internals.removeActiveKey(B); // {A}     — PTT release (in HF this is a no-op)
    internals.removeActiveKey(A); // {}

    // No spurious release/press around the toggle upgrade: exactly one press,
    // then the upgrade, then a single release. A pure-exact PTT would instead
    // produce press, release, toggle, press, release.
    expect(timeline).toEqual(["press", "toggle", "release"]);
  });

  it("does not start PTT while an unrelated key is held, nor when releasing down to the PTT set", () => {
    const { internals, timeline } = createManager();

    internals.addActiveKey(UNRELATED); // {U}
    internals.addActiveKey(A); // {U,A}
    internals.addActiveKey(B); // {U,A,B} — superset of PTT but not an exact match

    expect(timeline).not.toContain("press");

    // Dropping the extra key leaves exactly the PTT set, but PTT must NOT latch on a
    // key-up collapse — only a fresh key-down into the exact chord starts it.
    internals.removeActiveKey(UNRELATED); // {A,B} via key-up
    expect(timeline).toEqual([]);

    // Pressing the chord cleanly does start it.
    internals.removeActiveKey(B); // {A}
    internals.removeActiveKey(A); // {}
    internals.addActiveKey(A); // {A}
    internals.addActiveKey(B); // {A,B} via key-down → exact start
    expect(timeline).toEqual(["press"]);
  });

  it("does not emit a phantom PTT press when collapsing from toggle to the PTT set", () => {
    const { internals, timeline } = createManager();

    // Reach the toggle chord without first hitting exact PTT: the extra key goes
    // down before the PTT keys, so PTT never latched active.
    internals.addActiveKey(C); // {C}
    internals.addActiveKey(A); // {C,A}
    internals.addActiveKey(B); // {C,A,B} === toggle → fires; PTT never started
    expect(timeline).toEqual(["toggle"]);

    // Releasing the extra key collapses to exactly the PTT set. It must NOT emit a
    // press — RecordingManager treats pttPress in hands-free as a stop, which would
    // cancel the session.
    internals.removeActiveKey(C); // {A,B} via key-up
    expect(timeline).toEqual(["toggle"]);
  });

  it("emits a plain press/release for an exact PTT hold", () => {
    const { internals, timeline } = createManager();

    internals.addActiveKey(A);
    internals.addActiveKey(B); // exact → press
    internals.removeActiveKey(B); // → release
    internals.removeActiveKey(A);

    expect(timeline).toEqual(["press", "release"]);
  });
});
