import { describe, expect, it } from "vitest";
import { createManager, flush } from "./shortcut-manager-test-utils";

const A = 101;
const PHANTOM = 103;

describe("ShortcutManager recheck on shortcut-recording start", () => {
  it("kicks a recheck when recording starts so stale keys are pruned promptly", async () => {
    // PHANTOM is stuck from a missed key-up. Without the kick, the shortcut
    // recorder (which arms only once the active set drains to empty) would
    // wait up to the 10s periodic sweep before it could arm.
    const { manager, internals, recheckPressedKeys } = createManager({
      physicallyDown: new Set([A]),
    });
    internals.addActiveKey(A);
    internals.addActiveKey(PHANTOM);

    manager.setIsRecordingShortcut(true);
    await flush();

    expect(recheckPressedKeys).toHaveBeenCalledTimes(1);
    expect(internals.getActiveKeys()).toEqual([A]); // stale PHANTOM pruned
  });
});
