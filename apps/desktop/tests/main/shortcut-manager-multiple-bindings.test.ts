import { describe, expect, it, vi } from "vitest";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";
import { createManager } from "./shortcut-manager-test-utils";

const A = 101;
const B = 102;
const C = 103;
const D = 104;

describe("ShortcutManager multiple bindings", () => {
  it("starts PTT from either configured binding", () => {
    const { internals, timeline } = createManager();
    internals.shortcuts.pushToTalk = [[A], [B, C]];

    internals.addActiveKey(A);
    internals.removeActiveKey(A);
    internals.addActiveKey(B);
    internals.addActiveKey(C);
    internals.removeActiveKey(C);
    internals.removeActiveKey(B);

    expect(timeline).toEqual(["press", "release", "press", "release"]);
  });

  it("hands an active PTT hold between bindings without a false release", () => {
    const { internals, timeline } = createManager();
    internals.shortcuts.pushToTalk = [[A], [B]];

    internals.addActiveKey(A);
    internals.addActiveKey(B);
    internals.removeActiveKey(A);
    internals.removeActiveKey(B);

    expect(timeline).toEqual(["press", "release"]);
  });

  it("fires an exact action from either configured binding", () => {
    const { internals, timeline } = createManager();
    internals.shortcuts.toggleRecording = [
      [A, B],
      [C, D],
    ];

    internals.addActiveKey(A);
    internals.addActiveKey(B);
    internals.removeActiveKey(B);
    internals.removeActiveKey(A);
    internals.addActiveKey(C);
    internals.addActiveKey(D);

    expect(timeline).toEqual(["toggle", "toggle"]);
  });

  it("syncs every configured chord to the native helper", async () => {
    const setShortcuts = vi.fn().mockResolvedValue(true);
    const manager = ShortcutManager.createForTests(
      {} as never,
      { setShortcuts } as never,
    );
    const internals = manager as unknown as {
      shortcuts: {
        pushToTalk: number[][];
        toggleRecording: number[][];
        pasteLastTranscript: number[][];
        newNote: number[][];
        draftMode: number[][];
      };
      syncShortcutsToNative(): Promise<void>;
    };
    internals.shortcuts = {
      pushToTalk: [[A], [B]],
      toggleRecording: [
        [A, C],
        [B, D],
      ],
      pasteLastTranscript: [[A, D]],
      newNote: [],
      draftMode: [[C]],
    };

    await internals.syncShortcutsToNative();

    expect(setShortcuts).toHaveBeenCalledWith({
      subsetChords: [[A], [B], [C]],
      exactChords: [
        [A, C],
        [B, D],
        [A, D],
      ],
    });
  });
});
