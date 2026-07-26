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
  const rowId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.createVocabularyWord.mockImplementation(async (input) => input);
    dbMocks.updateVocabulary.mockImplementation(async (_id, input) => input);
    dbMocks.bulkImportVocabulary.mockImplementation(async (input) => input);
    dbMocks.createSnippet.mockImplementation(async (input) => input);
    dbMocks.updateSnippet.mockImplementation(async (_id, input) => input);
  });

  it("trims vocabulary keys and validates create, update, and import", async () => {
    const { vocabularyRouter } = await import(
      "../../src/trpc/routers/vocabulary"
    );
    const caller = vocabularyRouter.createCaller({} as never);
    const authoredWord = "  Mixed Case  ";

    await caller.createVocabularyWord({
      word: authoredWord,
      replacementWord: "replacement",
    });
    expect(dbMocks.createVocabularyWord).toHaveBeenCalledWith({
      word: "Mixed Case",
      replacementWord: "replacement",
    });

    await caller.updateVocabulary({
      id: rowId,
      data: { word: "  Updated  ", replacementWord: null },
    });
    expect(dbMocks.updateVocabulary).toHaveBeenCalledWith(rowId, {
      word: "Updated",
      replacementWord: null,
    });

    await caller.bulkImportVocabulary([{ word: "  Imported  " }]);
    expect(dbMocks.bulkImportVocabulary).toHaveBeenCalledWith([
      { word: "Imported" },
    ]);

    await expect(
      caller.createVocabularyWord({ word: " \t " }),
    ).rejects.toBeDefined();
    await expect(
      caller.createVocabularyWord({ word: "bad\0word" }),
    ).rejects.toBeDefined();
    await expect(
      caller.createVocabularyWord({ word: "bad\ud800word" }),
    ).rejects.toBeDefined();
    await expect(
      caller.createVocabularyWord({ word: ` ${"a".repeat(61)} ` }),
    ).rejects.toBeDefined();
    await expect(
      caller.createVocabularyWord({
        word: "valid",
        replacementWord: "r".repeat(4001),
      }),
    ).rejects.toBeDefined();
    await expect(
      caller.updateVocabulary({
        id: rowId,
        data: { replacementWord: "bad\0replacement" },
      }),
    ).rejects.toBeDefined();
    await expect(
      caller.bulkImportVocabulary([{ word: "bad\ud800word" }]),
    ).rejects.toBeDefined();

    expect(dbMocks.updateVocabulary).toHaveBeenCalledTimes(1);
    expect(dbMocks.bulkImportVocabulary).toHaveBeenCalledTimes(1);
  });

  it("trims snippet keys and rejects invalid text", async () => {
    const { snippetsRouter } = await import("../../src/trpc/routers/snippets");
    const caller = snippetsRouter.createCaller({} as never);
    const authoredTrigger = "  Mixed Case  ";

    await caller.createSnippet({
      trigger: authoredTrigger,
      content: "content",
    });
    expect(dbMocks.createSnippet).toHaveBeenCalledWith({
      trigger: "Mixed Case",
      content: "content",
    });

    await caller.updateSnippet({
      id: rowId,
      data: { trigger: "  Updated  " },
    });
    expect(dbMocks.updateSnippet).toHaveBeenCalledWith(rowId, {
      trigger: "Updated",
    });

    await expect(
      caller.createSnippet({ trigger: " \t ", content: "content" }),
    ).rejects.toBeDefined();
    await expect(
      caller.createSnippet({ trigger: "bad\0trigger", content: "content" }),
    ).rejects.toBeDefined();
    await expect(
      caller.createSnippet({
        trigger: "bad\udc00trigger",
        content: "content",
      }),
    ).rejects.toBeDefined();
    await expect(
      caller.createSnippet({
        trigger: ` ${"a".repeat(61)} `,
        content: "content",
      }),
    ).rejects.toBeDefined();
    await expect(
      caller.createSnippet({
        trigger: "valid",
        content: "c".repeat(4001),
      }),
    ).rejects.toBeDefined();
    await expect(
      caller.updateSnippet({
        id: rowId,
        data: { content: "bad\udc00content" },
      }),
    ).rejects.toBeDefined();

    expect(dbMocks.updateSnippet).toHaveBeenCalledTimes(1);
  });
});
