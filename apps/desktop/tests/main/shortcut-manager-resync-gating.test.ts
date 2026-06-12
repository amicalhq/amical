import { describe, expect, it } from "vitest";
import {
  createManager,
  flush,
  usePttShortcut,
  useToggleShortcut,
} from "./shortcut-manager-test-utils";

// Abstract keycodes. A "poisoned" key is one the user physically holds while
// the OS key table claims it is released (injected events — PowerToys-class
// remappers or our own masking — update the table without reaching the hook).
const A = 101;
const EXTRA = 102;

describe("ShortcutManager latched-PTT prune exemption", () => {
  it("keeps the latched PTT chord and prunes other stale keys", async () => {
    const physicallyDown = new Set([A, EXTRA]);
    const { manager, internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown,
    });
    usePttShortcut(internals);

    internals.addActiveKey(A); // exact PTT match latches
    expect(timeline).toEqual(["press"]);
    internals.addActiveKey(EXTRA); // superset recheck — both genuinely down
    await flush();

    // A is poisoned (held, table says released); EXTRA's key-up was missed.
    physicallyDown.delete(A);
    physicallyDown.delete(EXTRA);

    await manager.maybeRecheckPressedKeys(); // the periodic sweep
    await flush();

    // The latched chord key survives; the stale extra is pruned.
    expect(recheckPressedKeys).toHaveBeenCalled();
    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual(["press"]); // recording uninterrupted
  });

  it("keeps a held toggle chord — no phantom re-fire via prune + repeat re-add", async () => {
    // Toggle = [A], user abnormally HOLDS A through the recording, table
    // poisoned. Without the engaged-chord exemption: sweep prunes A → A's
    // auto-repeat re-adds it → false→true rising edge → phantom toggle stop.
    const physicallyDown = new Set([A]);
    const { manager, internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown,
    });
    useToggleShortcut(internals, [A]);

    internals.addActiveKey(A); // exact match — toggle fires once
    expect(timeline).toEqual(["toggle"]);

    physicallyDown.delete(A); // poisoned: table says A is up while held

    await manager.maybeRecheckPressedKeys(); // the periodic sweep
    await flush();
    internals.addActiveKey(A); // A's auto-repeat (held keys keep repeating)

    expect(recheckPressedKeys).toHaveBeenCalled();
    expect(internals.getActiveKeys()).toEqual([A]); // never pruned
    expect(timeline).toEqual(["toggle"]); // no phantom second fire
  });

  it("does not protect PTT keys before the chord latches", async () => {
    // Mid-chord (pressing slowly) nothing is latched yet, so a poisoned
    // sweep can prune — accepted: on Windows the held modifier's auto-repeat
    // re-adds it, and the worst case is a late/retried press, not a
    // truncated recording.
    const physicallyDown = new Set([A]);
    const { manager, internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown,
    });
    usePttShortcut(internals, [A, EXTRA]);

    internals.addActiveKey(A); // partial chord — no latch
    expect(timeline).toEqual([]);

    physicallyDown.delete(A); // poisoned mid-gap

    await manager.maybeRecheckPressedKeys(); // the periodic sweep
    await flush();

    expect(recheckPressedKeys).toHaveBeenCalled();
    expect(internals.getActiveKeys()).toEqual([]);
  });

  it("recorder-start drain survives capture starting mid-recheck", async () => {
    // A sweep is in flight when capture starts: the drain can only queue, and
    // its refire must bypass the capture gate or the recorder never arms. The
    // in-flight call samples OS truth on entry, so EXTRA going stale mid-
    // flight is invisible to it — only the refired drain can prune it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const physicallyDown = new Set([EXTRA]);
    const { manager, internals, recheckPressedKeys } = createManager({
      recheck: async ({ pressedKeyCodes }) => {
        const staleKeyCodes = pressedKeyCodes.filter(
          (code) => !physicallyDown.has(code),
        );
        await gate;
        return { staleKeyCodes };
      },
    });
    usePttShortcut(internals);

    internals.addActiveKey(EXTRA);
    void manager.maybeRecheckPressedKeys(); // sweep in flight

    manager.setIsRecordingShortcut(true); // drain queues behind it
    physicallyDown.delete(EXTRA); // EXTRA's key-up is missed mid-flight

    release();
    await flush();

    expect(recheckPressedKeys).toHaveBeenCalledTimes(2); // sweep + refired drain
    expect(internals.getActiveKeys()).toEqual([]); // recorder can arm
  });

  it("gates the sweep during capture, then cleans up on recorder exit", async () => {
    const physicallyDown = new Set([A]);
    const { manager, internals, recheckPressedKeys } = createManager({
      physicallyDown,
    });
    usePttShortcut(internals);

    internals.addActiveKey(A);
    manager.setIsRecordingShortcut(true);
    await flush();
    expect(recheckPressedKeys).toHaveBeenCalledTimes(1); // the start drain

    // Poisoned mid-capture: A reads released while physically held. The
    // recorder is defining a NEW chord, so no key set exists to scope an
    // exemption to — all pruning is gated.
    physicallyDown.delete(A);
    await manager.maybeRecheckPressedKeys(); // the periodic sweep
    await flush();
    expect(recheckPressedKeys).toHaveBeenCalledTimes(1); // gated
    expect(internals.getActiveKeys()).toEqual([A]); // capture state intact

    manager.setIsRecordingShortcut(false);
    await flush();
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2); // exit cleanup
    expect(internals.getActiveKeys()).toEqual([]);
  });
});
