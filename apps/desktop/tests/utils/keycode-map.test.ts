import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ windows: false }));
vi.mock("../../src/utils/platform", () => ({
  isWindows: () => platform.windows,
}));

import {
  formatShortcut,
  keycodeToDisplay,
  keycodeToLegend,
} from "../../src/utils/keycode-map";
import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../src/utils/keycodes";

describe("keycode map", () => {
  beforeEach(() => {
    platform.windows = false;
  });

  it("shows macOS modifiers as glyphs and Fn and Return as words", () => {
    expect(keycodeToDisplay(MAC_KEYCODES.ALT)).toBe("⌥");
    expect(keycodeToDisplay(MAC_KEYCODES.RCMD)).toBe("Right ⌘");
    expect(keycodeToDisplay(MAC_KEYCODES.FN)).toBe("Fn");
    expect(keycodeToDisplay(MAC_KEYCODES.ENTER)).toBe("Return");
  });

  it("shows Windows keys as title-case words", () => {
    platform.windows = true;
    expect(keycodeToDisplay(WINDOWS_KEYCODES.ALT)).toBe("Alt");
    expect(keycodeToDisplay(WINDOWS_KEYCODES.RALT)).toBe("Right Alt");
    expect(keycodeToDisplay(WINDOWS_KEYCODES.ESCAPE)).toBe("Esc");
  });

  it("gives a right-side macOS modifier its left twin's legend", () => {
    expect(keycodeToLegend(MAC_KEYCODES.RALT)).toEqual({
      glyph: "⌥",
      word: "Option",
      right: true,
    });
  });

  it("falls back to Key<code> for unmapped keycodes", () => {
    expect(keycodeToDisplay(999)).toBe("Key999");
  });

  it("formats a macOS shortcut in Apple order with no separator", () => {
    expect(
      formatShortcut([
        MAC_KEYCODES.THREE,
        MAC_KEYCODES.RCMD,
        MAC_KEYCODES.SHIFT,
      ]),
    ).toBe("⇧⌘3");
  });

  it("formats a Windows shortcut in Microsoft order with plus signs", () => {
    platform.windows = true;
    expect(
      formatShortcut([
        WINDOWS_KEYCODES.DELETE,
        WINDOWS_KEYCODES.ALT,
        WINDOWS_KEYCODES.RCTRL,
      ]),
    ).toBe("Ctrl+Alt+Delete");
  });
});
