import { describe, it, expect } from "vitest";
import { vi } from "vitest";

// migrateToV14 backfills the macOS default only on macOS, so the platform
// check is mocked per-test via this hoisted flag.
const platform = vi.hoisted(() => ({ macOS: true }));
vi.mock("../../src/utils/platform", () => ({
  isMacOS: () => platform.macOS,
}));

import { migrateToV14 } from "../../src/db/settings-migrations/v14";
import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../src/utils/keycodes";

const DRAFT_DEFAULT = [MAC_KEYCODES.FN, MAC_KEYCODES.CTRL];
const WIN_DRAFT_DEFAULT = [
  WINDOWS_KEYCODES.CTRL,
  WINDOWS_KEYCODES.WIN,
  WINDOWS_KEYCODES.ALT,
];

describe("migrateToV14", () => {
  it("renames a persisted instructMode binding to draftMode", () => {
    platform.macOS = true;
    const result = migrateToV14({
      shortcuts: { pushToTalk: [MAC_KEYCODES.FN], instructMode: [1, 2] },
    });
    expect(result.shortcuts).toEqual({
      pushToTalk: [MAC_KEYCODES.FN],
      draftMode: [1, 2],
    });
    expect(result.shortcuts).not.toHaveProperty("instructMode");
  });

  it("keeps an already-set draftMode when both keys exist (and drops instructMode)", () => {
    platform.macOS = true;
    const result = migrateToV14({
      shortcuts: { instructMode: [1], draftMode: [2] },
    });
    expect(result.shortcuts).toEqual({ draftMode: [2] });
  });

  it("backfills the Fn+Ctrl default on macOS when draftMode is unset", () => {
    platform.macOS = true;
    const result = migrateToV14({
      shortcuts: { pushToTalk: [MAC_KEYCODES.FN] },
    });
    expect(result.shortcuts).toEqual({
      pushToTalk: [MAC_KEYCODES.FN],
      draftMode: DRAFT_DEFAULT,
    });
  });

  it("does NOT backfill when Fn+Ctrl already maps to another shortcut (order-insensitive)", () => {
    platform.macOS = true;
    // newNote bound to the same chord, reversed order.
    const input = {
      shortcuts: {
        pushToTalk: [MAC_KEYCODES.FN],
        newNote: [MAC_KEYCODES.CTRL, MAC_KEYCODES.FN],
      },
    };
    const result = migrateToV14(input);
    expect(result.shortcuts).not.toHaveProperty("draftMode");
    expect(result.shortcuts).toEqual(input.shortcuts);
  });

  it("leaves an existing draftMode untouched (no instructMode present)", () => {
    platform.macOS = true;
    const result = migrateToV14({ shortcuts: { draftMode: [9] } });
    expect(result.shortcuts).toEqual({ draftMode: [9] });
  });

  it("backfills the Ctrl+Win+Alt default on non-macOS when draftMode is unset", () => {
    platform.macOS = false;
    const result = migrateToV14({
      shortcuts: { pushToTalk: [WINDOWS_KEYCODES.CTRL, WINDOWS_KEYCODES.WIN] },
    });
    expect(result.shortcuts).toEqual({
      pushToTalk: [WINDOWS_KEYCODES.CTRL, WINDOWS_KEYCODES.WIN],
      draftMode: WIN_DRAFT_DEFAULT,
    });
  });

  it("does NOT backfill on non-macOS when Ctrl+Win+Alt already maps elsewhere", () => {
    platform.macOS = false;
    const input = {
      // same chord as the Windows default, different order
      shortcuts: {
        pasteLastTranscript: [
          WINDOWS_KEYCODES.ALT,
          WINDOWS_KEYCODES.CTRL,
          WINDOWS_KEYCODES.WIN,
        ],
      },
    };
    const result = migrateToV14(input);
    expect(result.shortcuts).not.toHaveProperty("draftMode");
    expect(result.shortcuts).toEqual(input.shortcuts);
  });

  it("passes through when there is no shortcuts section", () => {
    platform.macOS = true;
    const result = migrateToV14({ ui: { theme: "dark" } });
    expect(result).toEqual({ ui: { theme: "dark" } });
  });
});
