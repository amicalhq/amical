import fs from "node:fs";
import { systemPreferences } from "electron";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

// Linux, as the boot path sees it.
vi.mock("../../src/utils/platform", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    isLinux: () => true,
    isMacOS: () => false,
    isWindows: () => false,
  };
});

import { NativeBridgeLive } from "../../src/main/runtime/layers";
import { ShortcutManager } from "../../src/main/managers/shortcut-manager";
import { OnboardingService } from "../../src/services/onboarding-service";
import {
  AppScopeTag,
  NativeBridgeTag,
  RecordingLifecycleTag,
  SettingsServiceTag,
  ShortcutManagerTag,
  TelemetryServiceTag,
} from "../../src/main/runtime/tags";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import type { ModelService } from "../../src/services/model-service";

const SHORTCUTS = {
  pushToTalk: [[63]],
  toggleRecording: [],
  pasteLastTranscript: [],
  newNote: [],
  draftMode: [],
};

describe("Linux boot", () => {
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = null;
    }
    vi.restoreAllMocks();
  });

  it("holds a null bridge when the helper binary is missing", async () => {
    vi.spyOn(fs, "accessSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        NativeBridgeLive.pipe(
          Layer.provide(
            Layer.succeed(TelemetryServiceTag, {
              captureException: vi.fn(),
            } as never),
          ),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.provide(scope)),
    );

    expect(Context.get(ctx, NativeBridgeTag)).toBeNull();
  });

  it("builds the shortcut manager without a bridge and still saves shortcut changes", async () => {
    const bindShortcutManager = vi.fn();
    const setShortcuts = vi.fn(async () => undefined);
    scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        ShortcutManager.Live.pipe(
          Layer.provide(
            Layer.succeed(SettingsServiceTag, {
              getShortcuts: async () => SHORTCUTS,
              setShortcuts,
            } as never),
          ),
          Layer.provide(Layer.succeed(NativeBridgeTag, null)),
          Layer.provide(
            Layer.succeed(RecordingLifecycleTag, {
              bindShortcutManager,
            } as never),
          ),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.provide(scope)),
    );

    const manager = Context.get(ctx, ShortcutManagerTag);
    expect(bindShortcutManager).toHaveBeenCalledWith(manager);

    const result = await manager.setShortcutBindings("toggleRecording", [
      [63, 49],
    ]);
    expect(result.valid).toBe(true);
    expect(setShortcuts).toHaveBeenCalledWith({
      ...SHORTCUTS,
      toggleRecording: [[63, 49]],
    });
  });

  it("passes the microphone check although Electron has no permission API", () => {
    // Electron defines getMediaAccessStatus only on macOS and Windows.
    const prefs = systemPreferences as unknown as Record<string, unknown>;
    const original = prefs.getMediaAccessStatus;
    delete prefs.getMediaAccessStatus;
    try {
      const service = OnboardingService.createForTests(
        {} as SettingsService,
        {} as TelemetryService,
        {} as ModelService,
      );
      expect(service.checkSystemPermissions().microphone).toBe(true);
    } finally {
      prefs.getMediaAccessStatus = original;
    }
  });
});
