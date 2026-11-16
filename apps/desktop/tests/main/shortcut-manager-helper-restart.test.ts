import { EventEmitter } from "node:events";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";
import {
  AppScopeTag,
  NativeBridgeTag,
  RecordingLifecycleTag,
  SettingsServiceTag,
  ShortcutManagerTag,
} from "../../src/main/runtime/tags";
import { flush } from "./shortcut-manager-test-utils";

const SHORTCUTS = {
  pushToTalk: [[63]],
  toggleRecording: [[63, 49]],
  pasteLastTranscript: [],
  newNote: [],
  draftMode: [[63, 59]],
};

// The pushes a new helper process must get, in wire order.
const RESYNC = [
  ["setShortcuts", { subsetChords: [[63], [63, 59]], exactChords: [[63, 49]] }],
  ["setAllowInjectedKeys", true],
];

describe("ShortcutManager after a native helper restart", () => {
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = null;
    }
  });

  // The bridge records every state push in wire order. The pushes from
  // initialization are dropped, so `pushes` holds only later ones.
  async function buildManager() {
    const pushes: unknown[][] = [];
    const record = (method: string) => async (arg: unknown) => {
      pushes.push([method, arg]);
      return true;
    };
    const bridge = Object.assign(new EventEmitter(), {
      setShortcuts: record("setShortcuts"),
      setAllowInjectedKeys: record("setAllowInjectedKeys"),
      setDraftEnterCapture: record("setDraftEnterCapture"),
    });
    const settings = {
      getShortcuts: async () => SHORTCUTS,
      getPreferences: async () => ({ allowInjectedKeys: true }),
    };
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
    await flush();
    pushes.length = 0;
    return { manager: Context.get(ctx, ShortcutManagerTag), bridge, pushes };
  }

  it("pushes the shortcuts and allow-injected-keys again on ready, without arming Draft-Enter", async () => {
    const { bridge, pushes } = await buildManager();

    bridge.emit("ready");
    await flush();

    expect(pushes).toEqual(RESYNC);
  });

  it("re-arms the Draft-Enter capture last when a draft review has it armed", async () => {
    const { manager, bridge, pushes } = await buildManager();
    manager.setDraftActive(true);

    bridge.emit("ready");
    await flush();

    expect(pushes).toEqual([...RESYNC, ["setDraftEnterCapture", true]]);
  });
});
