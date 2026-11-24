import { EventEmitter } from "node:events";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    isLinux: () => true,
    isMacOS: () => false,
    isWindows: () => false,
  };
});

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

describe("ShortcutManager in chord mode (Linux portal shortcuts)", () => {
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = null;
    }
  });

  async function buildManager() {
    const bridge = Object.assign(new EventEmitter(), {
      refreshHelperCapabilities: vi.fn(async () => null),
      getHelperCapabilities: vi.fn(() => null),
      setShortcuts: vi.fn(async () => ({ success: true })),
      setAllowInjectedKeys: vi.fn(async () => ({ success: true })),
      recheckPressedKeys: vi.fn(async () => ({ staleKeyCodes: [] })),
    });
    scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        ShortcutManager.Live.pipe(
          Layer.provide(
            Layer.succeed(SettingsServiceTag, {
              getShortcuts: async () => SHORTCUTS,
              getPreferences: async () => ({ allowInjectedKeys: false }),
            } as never),
          ),
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
    return { bridge, manager, events, bound, press, release };
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
});
