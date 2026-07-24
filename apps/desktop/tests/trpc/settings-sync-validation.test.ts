import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  createVocabularyWord: vi.fn(),
  updateVocabulary: vi.fn(),
  bulkImportVocabulary: vi.fn(),
  createSnippet: vi.fn(),
  updateSnippet: vi.fn(),
}));

vi.mock("../../src/db/vocabulary", () => ({
  getVocabulary: vi.fn(),
  getVocabularyById: vi.fn(),
  getVocabularyByWord: vi.fn(),
  createVocabularyWord: dbMocks.createVocabularyWord,
  updateVocabulary: dbMocks.updateVocabulary,
  deleteVocabulary: vi.fn(),
  getVocabularyCount: vi.fn(),
  searchVocabulary: vi.fn(),
  bulkImportVocabulary: dbMocks.bulkImportVocabulary,
  trackWordUsage: vi.fn(),
  getMostUsedWords: vi.fn(),
}));

vi.mock("../../src/db/snippets", () => ({
  createSnippet: dbMocks.createSnippet,
  deleteSnippet: vi.fn(),
  findSnippetByTriggerCaseInsensitive: vi.fn().mockResolvedValue(null),
  getSnippets: vi.fn(),
  updateSnippet: dbMocks.updateSnippet,
}));

describe("settings sync editor validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.createVocabularyWord.mockImplementation(async (input) => input);
    dbMocks.updateVocabulary.mockImplementation(async (_id, input) => input);
    dbMocks.bulkImportVocabulary.mockImplementation(async (input) => input);
    dbMocks.createSnippet.mockImplementation(async (input) => input);
    dbMocks.updateSnippet.mockImplementation(async (_id, input) => input);
  });

  it("preserves valid vocabulary keys and validates create, update, and import", async () => {
    const { vocabularyRouter } = await import(
      "../../src/trpc/routers/vocabulary"
    );
    const caller = vocabularyRouter.createCaller({} as never);
    const authoredWord = "  Mixed Case  ";

    await caller.createVocabularyWord({
      word: authoredWord,
      isReplacement: true,
      replacementWord: "replacement",
    });
    expect(dbMocks.createVocabularyWord).toHaveBeenCalledWith({
      word: authoredWord,
      isReplacement: true,
      replacementWord: "replacement",
    });

    await expect(
      caller.createVocabularyWord({ word: " \t " }),
    ).rejects.toBeDefined();
    await expect(
      caller.updateVocabulary({
        id: 1,
        data: { replacementWord: "bad\0replacement" },
      }),
    ).rejects.toBeDefined();
    await expect(
      caller.bulkImportVocabulary([{ word: "bad\ud800word" }]),
    ).rejects.toBeDefined();

    expect(dbMocks.updateVocabulary).not.toHaveBeenCalled();
    expect(dbMocks.bulkImportVocabulary).not.toHaveBeenCalled();
  });

  it("preserves valid snippet keys and rejects invalid text", async () => {
    const { snippetsRouter } = await import("../../src/trpc/routers/snippets");
    const caller = snippetsRouter.createCaller({} as never);
    const authoredTrigger = "  Mixed Case  ";

    await caller.createSnippet({
      trigger: authoredTrigger,
      content: "content",
    });
    expect(dbMocks.createSnippet).toHaveBeenCalledWith({
      trigger: authoredTrigger,
      content: "content",
    });

    await expect(
      caller.createSnippet({ trigger: " \t ", content: "content" }),
    ).rejects.toBeDefined();
    await expect(
      caller.updateSnippet({
        id: 1,
        data: { content: "bad\udc00content" },
      }),
    ).rejects.toBeDefined();

    expect(dbMocks.updateSnippet).not.toHaveBeenCalled();
  });
});
