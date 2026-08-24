import { describe, expect, it } from "vitest";
import {
  CURRENT_SETTINGS_VERSION,
  migrateSettings,
} from "../../src/db/settings-migrations";
import { migrateToV15 } from "../../src/db/settings-migrations/v15";

describe("migrateToV15", () => {
  it("wraps every assigned shortcut as the first binding", () => {
    const result = migrateToV15({
      shortcuts: {
        pushToTalk: [63],
        toggleRecording: [63, 49],
        pasteLastTranscript: [55, 59, 9],
        newNote: [55, 59, 45],
        draftMode: [63, 59],
      },
    });

    expect(result.shortcuts).toEqual({
      pushToTalk: [[63]],
      toggleRecording: [[63, 49]],
      pasteLastTranscript: [[55, 59, 9]],
      newNote: [[55, 59, 45]],
      draftMode: [[63, 59]],
    });
  });

  it("keeps absent and empty optional shortcuts unassigned", () => {
    const result = migrateToV15({
      shortcuts: {
        pushToTalk: [63],
        newNote: [],
      },
    });

    expect(result.shortcuts).toEqual({
      pushToTalk: [[63]],
      toggleRecording: undefined,
      pasteLastTranscript: undefined,
      newNote: undefined,
      draftMode: undefined,
    });
  });

  it("passes through settings without a shortcuts section", () => {
    expect(migrateToV15({ ui: { theme: "dark" } })).toEqual({
      ui: { theme: "dark" },
    });
  });

  it("is registered as the current migration", () => {
    expect(CURRENT_SETTINGS_VERSION).toBe(15);
    expect(
      migrateSettings(
        {
          shortcuts: {
            pushToTalk: [63],
            toggleRecording: [63, 49],
          },
        },
        14,
      ).shortcuts,
    ).toEqual({
      pushToTalk: [[63]],
      toggleRecording: [[63, 49]],
      pasteLastTranscript: undefined,
      newNote: undefined,
      draftMode: undefined,
    });
  });
});
