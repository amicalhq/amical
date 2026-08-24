import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/app-settings", () => ({
  getSettingsSection: vi.fn(),
  updateSettingsSection: vi.fn().mockResolvedValue(undefined),
  getAppSettings: vi.fn().mockResolvedValue({}),
  updateAppSettings: vi.fn().mockResolvedValue({}),
}));

import { SettingsService } from "../../src/services/settings-service";
import {
  getSettingsSection,
  updateSettingsSection,
} from "../../src/db/app-settings";

describe("SettingsService shortcut unassignment", () => {
  it("stores an empty shortcut as absent without changing assigned shortcuts", async () => {
    const service = SettingsService.createForTests();

    await service.setShortcuts({
      pushToTalk: [63],
      toggleRecording: [63, 49],
      pasteLastTranscript: [55, 59, 9],
      newNote: [],
      draftMode: [63, 59],
    });

    expect(updateSettingsSection).toHaveBeenCalledWith("shortcuts", {
      pushToTalk: [63],
      toggleRecording: [63, 49],
      pasteLastTranscript: [55, 59, 9],
      newNote: undefined,
      draftMode: [63, 59],
    });
  });

  it("reads an absent stored shortcut back as unassigned", async () => {
    vi.mocked(getSettingsSection).mockResolvedValueOnce({
      pushToTalk: [63],
      toggleRecording: [63, 49],
      pasteLastTranscript: [55, 59, 9],
      draftMode: [63, 59],
    });
    const service = SettingsService.createForTests();

    await expect(service.getShortcuts()).resolves.toEqual({
      pushToTalk: [63],
      toggleRecording: [63, 49],
      pasteLastTranscript: [55, 59, 9],
      newNote: [],
      draftMode: [63, 59],
    });
  });
});
