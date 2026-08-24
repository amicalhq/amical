import { describe, expect, it, vi } from "vitest";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";

describe("ShortcutManager shortcut unassignment", () => {
  it("rejects unassigning push-to-talk", async () => {
    const setShortcuts = vi.fn().mockResolvedValue(undefined);
    const syncNativeShortcuts = vi.fn().mockResolvedValue(true);
    const manager = ShortcutManager.createForTests(
      { setShortcuts } as never,
      { setShortcuts: syncNativeShortcuts } as never,
    );

    await expect(
      manager.setShortcutBindings("pushToTalk", []),
    ).resolves.toEqual({
      valid: false,
      error: { key: "settings.shortcuts.validation.noKeysDetected" },
    });
    expect(setShortcuts).not.toHaveBeenCalled();
    expect(syncNativeShortcuts).not.toHaveBeenCalled();
  });

  it("persists an empty shortcut and removes it from native matching", async () => {
    const setShortcuts = vi.fn().mockResolvedValue(undefined);
    const syncNativeShortcuts = vi.fn().mockResolvedValue(true);
    const manager = ShortcutManager.createForTests(
      { setShortcuts } as never,
      { setShortcuts: syncNativeShortcuts } as never,
    );

    await manager.setShortcutBindings("pushToTalk", [[63]]);
    await manager.setShortcutBindings("newNote", [[55, 59, 45]]);
    setShortcuts.mockClear();
    syncNativeShortcuts.mockClear();

    await expect(manager.setShortcutBindings("newNote", [])).resolves.toEqual({
      valid: true,
    });
    expect(setShortcuts).toHaveBeenCalledWith({
      pushToTalk: [[63]],
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

  it("serializes persistence and native synchronization", async () => {
    const setShortcuts = vi.fn().mockResolvedValue(undefined);
    const syncNativeShortcuts = vi.fn().mockResolvedValue(true);
    const manager = ShortcutManager.createForTests(
      { setShortcuts } as never,
      { setShortcuts: syncNativeShortcuts } as never,
    );

    await manager.setShortcutBindings("newNote", [[55, 59, 45]]);
    setShortcuts.mockClear();
    syncNativeShortcuts.mockClear();

    let releaseFirstNativeSync!: () => void;
    const firstNativeSync = new Promise<boolean>((resolve) => {
      releaseFirstNativeSync = () => resolve(true);
    });
    syncNativeShortcuts.mockImplementationOnce(() => firstNativeSync);

    const clearNewNote = manager.setShortcutBindings("newNote", []);
    const updateDraftMode = manager.setShortcutBindings("draftMode", [
      [63, 59],
    ]);

    await vi.waitFor(() => {
      expect(syncNativeShortcuts).toHaveBeenCalledTimes(1);
    });
    expect(setShortcuts).toHaveBeenCalledTimes(1);

    releaseFirstNativeSync();
    await Promise.all([clearNewNote, updateDraftMode]);

    expect(setShortcuts).toHaveBeenNthCalledWith(1, {
      pushToTalk: [],
      toggleRecording: [],
      pasteLastTranscript: [],
      newNote: [],
      draftMode: [],
    });
    expect(setShortcuts).toHaveBeenNthCalledWith(2, {
      pushToTalk: [],
      toggleRecording: [],
      pasteLastTranscript: [],
      newNote: [],
      draftMode: [[63, 59]],
    });
    expect(syncNativeShortcuts).toHaveBeenNthCalledWith(1, {
      subsetChords: [],
      exactChords: [],
    });
    expect(syncNativeShortcuts).toHaveBeenNthCalledWith(2, {
      subsetChords: [[63, 59]],
      exactChords: [],
    });
  });

  it("validates a queued mutation against the preceding result", async () => {
    const setShortcuts = vi.fn().mockResolvedValue(undefined);
    const syncNativeShortcuts = vi.fn().mockResolvedValue(true);
    const manager = ShortcutManager.createForTests(
      { setShortcuts } as never,
      { setShortcuts: syncNativeShortcuts } as never,
    );
    const shortcut = [55, 59, 45];

    const assignNewNote = manager.setShortcutBindings("newNote", [shortcut]);
    const assignDraftMode = manager.setShortcutBindings("draftMode", [
      shortcut,
    ]);

    await expect(assignNewNote).resolves.toEqual({ valid: true });
    await expect(assignDraftMode).resolves.toEqual({
      valid: false,
      error: { key: "settings.shortcuts.validation.alreadyAssigned" },
    });
    expect(setShortcuts).toHaveBeenCalledOnce();
    expect(syncNativeShortcuts).toHaveBeenCalledOnce();
  });

  it("continues processing after a failed mutation", async () => {
    const setShortcuts = vi
      .fn()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(undefined);
    const syncNativeShortcuts = vi.fn().mockResolvedValue(true);
    const manager = ShortcutManager.createForTests(
      { setShortcuts } as never,
      { setShortcuts: syncNativeShortcuts } as never,
    );

    const failedMutation = manager.setShortcutBindings("newNote", [
      [55, 59, 45],
    ]);
    const failedExpectation =
      expect(failedMutation).rejects.toThrow("write failed");
    const nextMutation = manager.setShortcutBindings("draftMode", [[63, 59]]);

    await failedExpectation;
    await expect(nextMutation).resolves.toEqual({ valid: true });
    expect(setShortcuts).toHaveBeenCalledTimes(2);
    expect(setShortcuts).toHaveBeenNthCalledWith(2, {
      pushToTalk: [],
      toggleRecording: [],
      pasteLastTranscript: [],
      newNote: [],
      draftMode: [[63, 59]],
    });
    expect(syncNativeShortcuts).toHaveBeenCalledOnce();
    expect(syncNativeShortcuts).toHaveBeenCalledWith({
      subsetChords: [[63, 59]],
      exactChords: [],
    });
  });
});
