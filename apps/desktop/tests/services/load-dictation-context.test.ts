import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/vocabulary", () => ({
  getAllVocabulary: vi.fn(),
}));

vi.mock("../../src/db/snippets", () => ({
  getAllSnippets: vi.fn(),
}));

import { getAllSnippets } from "../../src/db/snippets";
import { getAllVocabulary } from "../../src/db/vocabulary";
import { loadDictationContext } from "../../src/services/transcription/load-dictation-context";
import type { SettingsService } from "../../src/services/settings-service";

describe("loadDictationContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllVocabulary).mockResolvedValue([]);
    vi.mocked(getAllSnippets).mockResolvedValue([]);
  });

  it("loads selected languages, replacement vocabulary, hints, and snippets", async () => {
    vi.mocked(getAllVocabulary).mockResolvedValue([
      {
        word: "replacement",
        replacementWord: "expanded replacement",
        dateAdded: new Date("2026-01-01"),
      },
      {
        word: "new hint",
        replacementWord: null,
        dateAdded: new Date("2026-03-01"),
      },
      {
        word: "old hint",
        replacementWord: null,
        dateAdded: new Date("2026-02-01"),
      },
    ] as Awaited<ReturnType<typeof getAllVocabulary>>);
    vi.mocked(getAllSnippets).mockResolvedValue([
      {
        trigger: "signature",
        content: "Best regards",
      },
    ] as Awaited<ReturnType<typeof getAllSnippets>>);
    const settingsService = {
      getDictationSettings: vi.fn(async () => ({
        autoDetectEnabled: false,
        languages: ["en", "es"],
      })),
    } as unknown as Pick<SettingsService, "getDictationSettings">;

    const context = await loadDictationContext({
      settingsService,
      sessionId: "session-1",
    });

    expect(context).toMatchObject({
      sessionId: "session-1",
      languages: ["en", "es"],
      vocabulary: ["new hint", "old hint"],
      formattingStyle: "formal",
      audio: { source: "microphone" },
      accessibilityContext: null,
      cloudFormattingEnabled: false,
      isInstruct: false,
    });
    expect(context.replacements).toEqual(
      new Map([
        ["replacement", "expanded replacement"],
        ["signature", "Best regards"],
      ]),
    );
  });

  it("uses automatic language selection and creates a fresh session ID", async () => {
    const settingsService = {
      getDictationSettings: vi.fn(async () => ({
        autoDetectEnabled: true,
        languages: ["en"],
      })),
    } as unknown as Pick<SettingsService, "getDictationSettings">;

    const first = await loadDictationContext({ settingsService });
    const second = await loadDictationContext({ settingsService });

    expect(first.languages).toBeUndefined();
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  it("treats an empty configured language list as automatic", async () => {
    const settingsService = {
      getDictationSettings: vi.fn(async () => ({
        autoDetectEnabled: false,
        languages: [],
      })),
    } as unknown as Pick<SettingsService, "getDictationSettings">;

    const context = await loadDictationContext({ settingsService });

    expect(context.languages).toBeUndefined();
  });
});
