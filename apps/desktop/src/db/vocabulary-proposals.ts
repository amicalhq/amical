import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from ".";
import {
  vocabularyProposals,
  type VocabularyProposal,
  type NewVocabularyProposal,
} from "./schema";
import {
  createVocabularyWord,
  getVocabularyByWord,
  updateVocabulary,
} from "./vocabulary";

export type ProposalStatus = "pending" | "approved" | "rejected";

// Create a new vocabulary proposal (always starts "pending")
export async function createProposal(
  data: Pick<NewVocabularyProposal, "word"> &
    Partial<
      Pick<
        NewVocabularyProposal,
        "replacementWord" | "rationale" | "contextSnippet" | "transcriptionId"
      >
    >,
): Promise<VocabularyProposal> {
  const now = new Date();
  return db
    .insert(vocabularyProposals)
    .values({
      word: data.word,
      replacementWord: data.replacementWord ?? null,
      rationale: data.rationale ?? null,
      contextSnippet: data.contextSnippet ?? null,
      transcriptionId: data.transcriptionId ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

// List proposals, most recent first
export async function listProposals(
  options: { status?: ProposalStatus; limit?: number; offset?: number } = {},
): Promise<VocabularyProposal[]> {
  const { status, limit = 50, offset = 0 } = options;

  if (status) {
    return db
      .select()
      .from(vocabularyProposals)
      .where(eq(vocabularyProposals.status, status))
      .orderBy(desc(vocabularyProposals.createdAt))
      .limit(limit)
      .offset(offset);
  }
  return db
    .select()
    .from(vocabularyProposals)
    .orderBy(desc(vocabularyProposals.createdAt))
    .limit(limit)
    .offset(offset);
}

// Count of pending proposals, for the settings UI badge
export async function countPendingProposals(): Promise<number> {
  return (
    await listProposals({ status: "pending", limit: Number.MAX_SAFE_INTEGER })
  ).length;
}

export async function getProposalById(
  id: number,
): Promise<VocabularyProposal | null> {
  const result = await db
    .select()
    .from(vocabularyProposals)
    .where(eq(vocabularyProposals.id, id));
  return result[0] ?? null;
}

// Find an existing pending proposal for the same (word, replacementWord)
// pair, so an MCP client's duplicate suggestion doesn't spam the queue.
export async function findPendingProposal(
  word: string,
  replacementWord: string | null,
): Promise<VocabularyProposal | null> {
  const result = await db
    .select()
    .from(vocabularyProposals)
    .where(
      and(
        eq(vocabularyProposals.status, "pending"),
        sql`lower(${vocabularyProposals.word}) = lower(${word})`,
        replacementWord === null
          ? isNull(vocabularyProposals.replacementWord)
          : sql`lower(${vocabularyProposals.replacementWord}) = lower(${replacementWord})`,
      ),
    );
  return result[0] ?? null;
}

export async function rejectProposal(
  id: number,
): Promise<VocabularyProposal | null> {
  const proposal = await getProposalById(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending")
    throw new Error("Proposal already decided");

  const now = new Date();
  return db
    .update(vocabularyProposals)
    .set({ status: "rejected", decidedAt: now, updatedAt: now })
    .where(eq(vocabularyProposals.id, id))
    .returning()
    .get();
}

// Approve a proposal: turn it into a real vocabulary entry.
//
// `vocabulary` has a unique constraint on (scope_type, scope_id, word), so
// this MUST branch update-vs-insert rather than always inserting — and it
// MUST go through the existing vocabulary.ts helpers (not a raw insert) so
// the cloud sync mutation is recorded in the same transaction.
export async function approveProposal(
  id: number,
): Promise<VocabularyProposal | null> {
  const proposal = await getProposalById(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending")
    throw new Error("Proposal already decided");

  // Org-scoped dictionaries have separate write permissions
  // (getWritableOrganizationIdentity); approval only ever targets the
  // user's own vocabulary.
  const existing = await getVocabularyByWord(proposal.word);
  const entry =
    existing && existing.scopeType === "user"
      ? await updateVocabulary(existing.id, {
          replacementWord: proposal.replacementWord,
        })
      : await createVocabularyWord({
          word: proposal.word,
          replacementWord: proposal.replacementWord,
        });

  if (!entry) throw new Error("Failed to apply vocabulary entry");

  const now = new Date();
  return db
    .update(vocabularyProposals)
    .set({
      status: "approved",
      vocabularyId: entry.id,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(vocabularyProposals.id, id))
    .returning()
    .get();
}
