import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { vocabulary } from "../../src/db/schema";
import { getVocabularyByWord } from "../../src/db/vocabulary";
import {
  approveProposal,
  countPendingProposals,
  createProposal,
  findPendingProposal,
  getProposalById,
  listProposals,
  rejectProposal,
} from "../../src/db/vocabulary-proposals";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

type DesktopDatabase = typeof import("../../src/db").db;

describe("vocabulary proposals", () => {
  let testDb: TestDatabase;
  let database: DesktopDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    database = testDb.db as unknown as DesktopDatabase;
    setTestDatabase(database);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("creates a pending proposal", async () => {
    const proposal = await createProposal({
      word: "Amikal",
      replacementWord: "Amical",
      rationale: "Misheard product name",
      contextSnippet: "...using Amikal for dictation...",
    });

    expect(proposal.status).toBe("pending");
    expect(proposal.word).toBe("Amikal");
    expect(proposal.replacementWord).toBe("Amical");
    expect(proposal.vocabularyId).toBeNull();
    expect(proposal.decidedAt).toBeNull();

    const fetched = await getProposalById(proposal.id);
    expect(fetched?.id).toBe(proposal.id);
  });

  it("detects a duplicate pending proposal for the same (word, replacementWord)", async () => {
    const created = await createProposal({
      word: "Amikal",
      replacementWord: "Amical",
      rationale: "First proposal",
    });

    const duplicate = await findPendingProposal("amikal", "amical");
    expect(duplicate?.id).toBe(created.id);

    const notDuplicate = await findPendingProposal("Amikal", null);
    expect(notDuplicate).toBeNull();
  });

  it("rejecting a proposal sets status and decidedAt", async () => {
    const created = await createProposal({
      word: "Wisper",
      replacementWord: "Whisper",
      rationale: "Homophone typo",
    });

    const rejected = await rejectProposal(created.id);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.decidedAt).not.toBeNull();

    const pending = await listProposals({ status: "pending" });
    expect(pending.find((p) => p.id === created.id)).toBeUndefined();
  });

  it("rejects deciding an already-decided proposal", async () => {
    const created = await createProposal({ word: "Foo", rationale: "test" });
    await rejectProposal(created.id);

    await expect(rejectProposal(created.id)).rejects.toThrow(
      "Proposal already decided",
    );
    await expect(approveProposal(created.id)).rejects.toThrow(
      "Proposal already decided",
    );
  });

  it("approving a new word inserts a vocabulary entry (unique-constraint regression)", async () => {
    // getVocabularyByWord() lower-cases its search term but not the stored
    // word, so it only matches already-lowercase words — use lowercase here
    // to exercise the real lookup path rather than this pre-existing quirk.
    const created = await createProposal({
      word: "amikal",
      replacementWord: "Amical",
      rationale: "Misheard product name",
    });

    const approved = await approveProposal(created.id);
    expect(approved?.status).toBe("approved");
    expect(approved?.vocabularyId).not.toBeNull();

    const entry = await getVocabularyByWord("amikal");
    expect(entry?.replacementWord).toBe("Amical");
    expect(entry?.id).toBe(approved?.vocabularyId);
  });

  it("approving a word that already exists in the user's vocabulary updates it instead of inserting (unique-constraint regression)", async () => {
    database
      .insert(vocabulary)
      .values({
        word: "amikal",
        replacementWord: "Old Replacement",
        scopeType: "user",
        scopeId: "",
      })
      .run();

    const created = await createProposal({
      word: "amikal",
      replacementWord: "Amical",
      rationale: "Correcting an earlier bad entry",
    });

    const approved = await approveProposal(created.id);
    expect(approved?.status).toBe("approved");

    const rows = database.select().from(vocabulary).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].replacementWord).toBe("Amical");
    expect(approved?.vocabularyId).toBe(rows[0].id);
  });

  it("counts only pending proposals", async () => {
    const first = await createProposal({ word: "A", rationale: "r" });
    await createProposal({ word: "B", rationale: "r" });
    await rejectProposal(first.id);

    expect(await countPendingProposals()).toBe(1);
  });
});
