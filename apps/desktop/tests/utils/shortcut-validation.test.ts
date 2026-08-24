import { describe, expect, it } from "vitest";
import {
  checkMaxKeysLength,
  type ShortcutType,
  validateShortcutComprehensive,
} from "../../src/utils/shortcut-validation";

describe("shortcut validation", () => {
  it.each<ShortcutType>([
    "toggleRecording",
    "pasteLastTranscript",
    "newNote",
    "draftMode",
  ])("accepts an empty %s shortcut as an explicit unassignment", (type) => {
    expect(
      validateShortcutComprehensive({
        candidateShortcut: [],
        candidateType: type,
        shortcutsByType: {
          pushToTalk: [63],
          toggleRecording: [63, 49],
          pasteLastTranscript: [55, 59, 9],
          newNote: [55, 59, 45],
          draftMode: [63, 59],
        },
        platform: "darwin",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects unassigning push-to-talk", () => {
    expect(
      validateShortcutComprehensive({
        candidateShortcut: [],
        candidateType: "pushToTalk",
        shortcutsByType: {
          pushToTalk: [63],
          toggleRecording: [63, 49],
          pasteLastTranscript: [55, 59, 9],
          newNote: [55, 59, 45],
          draftMode: [63, 59],
        },
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
});
