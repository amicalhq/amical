import { EventEmitter } from "node:events";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    isLinux: () => true,
    isMacOS: () => false,
    isWindows: () => false,
  };
});

import { BrowserWindow } from "electron";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";
import {
  AppScopeTag,
  NativeBridgeTag,
  RecordingLifecycleTag,
  SettingsServiceTag,
  ShortcutManagerTag,
} from "../../src/main/runtime/tags";

// Ctrl+Alt+Space, Ctrl+Alt+H, Ctrl+Alt+N, Ctrl+Alt+Enter (evdev codes).
const SHORTCUTS = {
  pushToTalk: [[29, 56, 57]],
  toggleRecording: [[29, 56, 35]],
  pasteLastTranscript: [],
  newNote: [[29, 56, 49]],
  draftMode: [[29, 56, 28]],
};
// The stored shortcut id of each key set (sorted key codes).
const SYSTEM_IDS = {
  pushToTalk: { "29+56+57": "pushToTalk:0" },
  toggleRecording: { "29+35+56": "toggleRecording:0" },
  newNote: { "29+49+56": "newNote:0" },
  draftMode: { "28+29+56": "draftMode:0" },
};

describe("ShortcutManager in chord mode (Linux portal shortcuts)", () => {
  let scope: Scope.Closeable | null = null;

  // Validation reads the Linux key sets from process.platform.
  const platform = process.platform;
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
    vi.useRealTimers();
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = null;
    }
  });

  async function buildManager({ chord = false } = {}) {
    const settings = {
      getShortcuts: async () => SHORTCUTS,
      getPreferences: async () => ({ allowInjectedKeys: false }),
      getSystemShortcutIds: async () => SYSTEM_IDS,
      setShortcuts: vi.fn(async () => {}),
      setSystemShortcutIds: vi.fn(async () => {}),
    };
    const bridge = Object.assign(new EventEmitter(), {
      refreshHelperCapabilities: vi.fn(async () => null),
      getHelperCapabilities: vi.fn(() =>
        chord
          ? { keyInputMode: "chord", holdSupport: "unmodified-key-only" }
          : null,
      ),
      setShortcuts: vi.fn(async () => ({ success: true })),
      setAllowInjectedKeys: vi.fn(async () => ({ success: true })),
      recheckPressedKeys: vi.fn(async () => ({ staleKeyCodes: [] })),
    });
    scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        ShortcutManager.Live.pipe(
          Layer.provide(Layer.succeed(SettingsServiceTag, settings as never)),
          Layer.provide(Layer.succeed(NativeBridgeTag, bridge as never)),
          Layer.provide(
            Layer.succeed(RecordingLifecycleTag, {
              bindShortcutManager: vi.fn(),
            } as never),
          ),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.provide(scope)),
    );
    await vi.waitFor(() => expect(bridge.setShortcuts).toHaveBeenCalled());
    const manager = Context.get(ctx, ShortcutManagerTag);
    const events: string[] = [];
    manager.on("ptt-state-changed", (engaged: boolean) =>
      events.push(`ptt ${engaged}`),
    );
    for (const name of [
      "toggle-recording-triggered",
      "paste-last-transcript-triggered",
      "open-notes-window-triggered",
    ]) {
      manager.on(name, () => events.push(name));
    }
    const helper = (event: object) => bridge.emit("helperEvent", event);
    const bound = (holdReliable: boolean) =>
      helper({
        type: "shortcutsBound",
        payload: {
          bound: ["pushToTalk:0", "draftMode:0"].map((id) => ({
            id,
            trigger: "Press it",
            holdReliable,
          })),
          failed: [],
          pending: false,
        },
      });
    const press = (id: string) =>
      helper({ type: "shortcutActivated", payload: { id } });
    const release = (id: string) =>
      helper({ type: "shortcutDeactivated", payload: { id } });
    return { bridge, settings, manager, events, helper, bound, press, release };
  }

  /** The descriptors of the latest setShortcuts call. */
  function lastDescriptors(bridge: { setShortcuts: ReturnType<typeof vi.fn> }) {
    const [params] = bridge.setShortcuts.mock.lastCall as [
      { shortcuts: { id: string; keyCodes: number[] }[] },
    ];
    return params.shortcuts;
  }

  it("sends one descriptor per configured chord, in the user's language", async () => {
    const { bridge } = await buildManager();
    expect(bridge.setShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [
          {
            id: "pushToTalk:0",
            keyCodes: [29, 56, 57],
            label: "Push to talk",
            kind: "hold",
          },
          {
            id: "draftMode:0",
            keyCodes: [29, 56, 28],
            label: "Draft",
            kind: "hold",
          },
          {
            id: "toggleRecording:0",
            keyCodes: [29, 56, 35],
            label: "Hands-free mode",
            kind: "tap",
          },
          {
            id: "newNote:0",
            keyCodes: [29, 56, 49],
            label: "New note",
            kind: "tap",
          },
        ],
      }),
    );
  });

  it("holds to talk when the release is reliable, and tags Draft", async () => {
    const { manager, events, bound, press, release } = await buildManager();
    bound(true);
    press("draftMode:0");
    expect(manager.isPTTDraftActive()).toBe(true);
    release("draftMode:0");
    expect(events).toEqual(["ptt true", "ptt false"]);
  });

  it("toggles when the release is not reliable: the second press stops", async () => {
    const { events, bound, press, release } = await buildManager();
    bound(false);
    press("pushToTalk:0");
    release("pushToTalk:0");
    expect(events).toEqual(["ptt true"]);
    press("pushToTalk:0");
    expect(events).toEqual(["ptt true", "ptt false"]);
  });

  it("stops a hold whose release never comes", async () => {
    const { events, bound, press } = await buildManager();
    bound(true);
    vi.useFakeTimers();
    press("pushToTalk:0");
    vi.advanceTimersByTime(59_000);
    expect(events).toEqual(["ptt true"]);
    vi.advanceTimersByTime(1_000);
    expect(events).toEqual(["ptt true", "ptt false"]);
  });

  it("runs tap shortcuts on the press only", async () => {
    const { events, press, release } = await buildManager();
    press("toggleRecording:0");
    release("toggleRecording:0");
    press("newNote:0");
    release("newNote:0");
    expect(events).toEqual([
      "toggle-recording-triggered",
      "open-notes-window-triggered",
    ]);
  });

  describe("changing a shortcut in Amical", () => {
    it("gives a new key set a new id and keeps it when the system binds it", async () => {
      const { bridge, manager, helper } = await buildManager({ chord: true });
      const result = manager.setShortcutBindings("pushToTalk", [[67]]);
      await vi.waitFor(() =>
        expect(lastDescriptors(bridge)[0].keyCodes).toEqual([67]),
      );
      const newId = lastDescriptors(bridge)[0].id;
      expect(newId).toMatch(/^pushToTalk:/);
      expect(newId).not.toBe("pushToTalk:0");
      // Unchanged key sets keep their ids: the system binds them silently.
      expect(
        lastDescriptors(bridge)
          .slice(1)
          .map(({ id }) => id),
      ).toEqual(["draftMode:0", "toggleRecording:0", "newNote:0"]);
      helper({
        type: "shortcutsBound",
        payload: {
          bound: [newId, "draftMode:0", "toggleRecording:0", "newNote:0"].map(
            (id) => ({ id, trigger: "Press it", holdReliable: true }),
          ),
          failed: [],
          pending: false,
        },
      });
      await expect(result).resolves.toEqual({ valid: true });
    });

    it("restores the old keys and ids when the user closes the system dialog", async () => {
      const { bridge, settings, manager, helper } = await buildManager({
        chord: true,
      });
      const result = manager.setShortcutBindings("pushToTalk", [[67]]);
      await vi.waitFor(() =>
        expect(lastDescriptors(bridge)[0].keyCodes).toEqual([67]),
      );
      const newId = lastDescriptors(bridge)[0].id;
      // The pending hint names no result yet.
      helper({
        type: "shortcutsBound",
        payload: { bound: [], failed: [], pending: true },
      });
      helper({
        type: "shortcutsBound",
        payload: {
          bound: [],
          failed: [newId, "draftMode:0", "toggleRecording:0", "newNote:0"].map(
            (id) => ({ id, reason: "dismissed" }),
          ),
          pending: false,
        },
      });
      await expect(result).resolves.toEqual({
        valid: false,
        error: { key: "settings.shortcuts.toast.systemDialogClosed" },
      });
      expect(lastDescriptors(bridge)[0]).toMatchObject({
        id: "pushToTalk:0",
        keyCodes: [29, 56, 57],
      });
      expect(settings.setShortcuts).toHaveBeenLastCalledWith(SHORTCUTS);
      expect(settings.setSystemShortcutIds).toHaveBeenLastCalledWith(
        SYSTEM_IDS,
      );
    });

    it("refuses a shortcut without exactly one non-modifier key", async () => {
      const { manager } = await buildManager({ chord: true });
      // Right Ctrl alone.
      await expect(
        manager.setShortcutBindings("pushToTalk", [[97]]),
      ).resolves.toMatchObject({
        valid: false,
        error: { key: "settings.shortcuts.validation.systemShortcutShape" },
      });
    });
  });

  it("records keys from Amical's windows, plus a shortcut that the system took", async () => {
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
    });
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: contents } as never,
    ]);
    const { manager, press, release } = await buildManager({ chord: true });
    const seen: number[][] = [];
    manager.on("activeKeysChanged", (keys: number[]) => seen.push(keys));
    const key = (type: string, code: string) =>
      contents.emit("before-input-event", {}, { type, code });

    manager.setIsRecordingShortcut(true);
    key("keyDown", "ControlLeft");
    key("keyDown", "AltLeft");
    // Space completes Amical's push-to-talk chord: the system takes it.
    press("pushToTalk:0");
    release("pushToTalk:0");
    key("keyUp", "AltLeft");
    expect(seen).toEqual([[29], [29, 56], [29, 56, 57], [29, 56], [29]]);

    manager.setIsRecordingShortcut(false);
    key("keyUp", "ControlLeft");
    expect(seen).toHaveLength(5);
  });
});
