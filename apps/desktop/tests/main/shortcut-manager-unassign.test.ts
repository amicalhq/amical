import { describe, expect, it, vi } from "vitest";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";

describe("ShortcutManager shortcut unassignment", () => {
  it("persists an empty shortcut and removes it from native matching", async () => {
    const setShortcuts = vi.fn().mockResolvedValue(undefined);
    const syncNativeShortcuts = vi.fn().mockResolvedValue({ success: true });
    const manager = ShortcutManager.createForTests(
      { setShortcuts } as never,
      { setShortcuts: syncNativeShortcuts } as never,
    );

    await manager.setShortcut("pushToTalk", [63]);
    await manager.setShortcut("newNote", [55, 59, 45]);
    setShortcuts.mockClear();
    syncNativeShortcuts.mockClear();

    await expect(manager.setShortcut("newNote", [])).resolves.toEqual({
      valid: true,
    });
    expect(setShortcuts).toHaveBeenCalledWith({
      pushToTalk: [63],
      toggleRecording: [],
      pasteLastTranscript: [],
      newNote: [],
      draftMode: [],
    });
    expect(syncNativeShortcuts).toHaveBeenCalledWith({
      subsetChords: [[63]],
      exactChords: [],
    });
  });
});
