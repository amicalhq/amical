import { vi } from "vitest";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";

export type ShortcutManagerInternals = {
  shortcuts: {
    pushToTalk: number[];
    toggleRecording: number[];
    pasteLastTranscript: number[];
    newNote: number[];
  };
  addActiveKey(keyCode: number): void;
  removeActiveKey(keyCode: number): void;
  getActiveKeys(): number[];
};

type RecheckArgs = { pressedKeyCodes: number[] };
type RecheckResult = { staleKeyCodes: number[] };

// setTimeout(0) is a macrotask: it runs after the resync RPC promise and its
// follow-on prune microtasks have settled.
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Build a ShortcutManager wired to a mock native bridge.
 *
 * The native helper's resync reports back every requested key that the OS says
 * is not actually physically down. `physicallyDown` is mutable so a test can
 * drop a key (simulating a missed key-up) between resync calls; omitting it
 * means every held key is genuinely down (nothing is ever stale). Pass
 * `recheck` to fully control the RPC, e.g. to hold a response in flight.
 *
 * Shortcuts start empty — assign `internals.shortcuts` per test. The timeline
 * mirrors how recording-manager consumes the events: PTT is edge-detected (act
 * only on changes), toggle fires directly, so it is the exact event sequence
 * that would drive the recording FSM.
 */
export const createManager = (
  opts: {
    physicallyDown?: Set<number>;
    recheck?: (args: RecheckArgs) => Promise<RecheckResult>;
  } = {},
) => {
  const { physicallyDown } = opts;
  const recheckPressedKeys = vi.fn(
    opts.recheck ??
      (async ({ pressedKeyCodes }: RecheckArgs): Promise<RecheckResult> => ({
        staleKeyCodes: physicallyDown
          ? pressedKeyCodes.filter((code) => !physicallyDown.has(code))
          : [],
      })),
  );
  const nativeBridge = { recheckPressedKeys } as unknown;

  const manager = new ShortcutManager({} as never, nativeBridge as never);
  const internals = manager as unknown as ShortcutManagerInternals;
  internals.shortcuts = {
    pushToTalk: [],
    toggleRecording: [],
    pasteLastTranscript: [],
    newNote: [],
  };

  const timeline: string[] = [];
  let lastPtt = false;
  manager.on("ptt-state-changed", (pressed: boolean) => {
    if (pressed !== lastPtt) {
      lastPtt = pressed;
      timeline.push(pressed ? "press" : "release");
    }
  });
  manager.on("toggle-recording-triggered", () => timeline.push("toggle"));

  return { manager, internals, timeline, recheckPressedKeys };
};
