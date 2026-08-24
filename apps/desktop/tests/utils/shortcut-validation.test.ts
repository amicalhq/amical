import { describe, expect, it } from "vitest";
import {
  checkMaxKeysLength,
  type ShortcutType,
  validateShortcutBindings,
} from "../../src/utils/shortcut-validation";

const shortcuts = {
  pushToTalk: [[63]],
  toggleRecording: [[63, 49]],
  pasteLastTranscript: [[55, 59, 9]],
  newNote: [[55, 59, 45]],
  draftMode: [[63, 59]],
};

describe("shortcut validation", () => {
  it.each<ShortcutType>([
    "toggleRecording",
    "pasteLastTranscript",
    "newNote",
    "draftMode",
  ])("accepts an empty %s binding list as an explicit unassignment", (type) => {
    expect(
      validateShortcutBindings({
        candidateBindings: [],
        candidateType: type,
        shortcutsByType: shortcuts,
        platform: "darwin",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects unassigning push-to-talk", () => {
    expect(
      validateShortcutBindings({
        candidateBindings: [],
        candidateType: "pushToTalk",
        shortcutsByType: shortcuts,
        platform: "darwin",
      }),
    ).toEqual({
      valid: false,
      error: { key: "settings.shortcuts.validation.noKeysDetected" },
    });
  });

  it("continues to reject an empty recording", () => {
    expect(checkMaxKeysLength([])).toEqual({
      valid: false,
      error: { key: "settings.shortcuts.validation.noKeysDetected" },
    });
  });

  it("accepts multiple distinct bindings for one action", () => {
    expect(
      validateShortcutBindings({
        candidateBindings: [[63], [55, 59, 11]],
        candidateType: "pushToTalk",
        shortcutsByType: shortcuts,
        platform: "darwin",
      }),
    ).toEqual({ valid: true, warning: undefined });
  });

  it("rejects duplicate bindings within one action regardless of key order", () => {
    expect(
      validateShortcutBindings({
        candidateBindings: [
          [55, 59, 11],
          [11, 55, 59],
        ],
        candidateType: "pushToTalk",
        shortcutsByType: shortcuts,
        platform: "darwin",
      }),
    ).toEqual({
      valid: false,
      error: { key: "settings.shortcuts.validation.alreadyAssigned" },
    });
  });

  it("rejects a binding already assigned to another action", () => {
    expect(
      validateShortcutBindings({
        candidateBindings: [[55, 59, 45]],
        candidateType: "draftMode",
        shortcutsByType: shortcuts,
        platform: "darwin",
      }),
    ).toEqual({
      valid: false,
      error: { key: "settings.shortcuts.validation.alreadyAssigned" },
    });
  });
});
