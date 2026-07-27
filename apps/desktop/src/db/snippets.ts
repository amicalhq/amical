import { eq, desc, like, or } from "drizzle-orm";
import { db } from ".";
import { snippets, type Snippet, type NewSnippet } from "./schema";
import { recordLocalSyncMutation, snippetSyncPayload } from "./sync";

/**
 * Find a snippet that is "similar" to the given trigger — both sides are
 * normalized with `String.prototype.trim()` + `toLowerCase()` so leading and
 * trailing whitespace (including Unicode whitespace like NBSP and ideographic
 * space) and case differences all count as similar. Storage itself stays
 * verbatim. Comparison runs in JS rather than SQL because SQLite's built-in
 * `trim()` with no charset arg only strips ASCII whitespace; full-table scan
 * is fine — the table is capped at 200 rows in practice.
 */
export async function findSnippetByTriggerCaseInsensitive(
  trigger: string,
): Promise<Snippet | null> {
  const normalized = trigger.trim().toLowerCase();
  const all = await db.select().from(snippets);
  return (
    all.find((row) => row.trigger.trim().toLowerCase() === normalized) ?? null
  );
}

/**
 * Load every snippet row. Used by the transcription pipeline so that every
 * trigger the user has authored participates in expansion — no silent cap.
 * The settings UI uses `getSnippets` which is capped/sortable/searchable.
 */
export async function getAllSnippets(): Promise<Snippet[]> {
  return await db.select().from(snippets);
}

export async function createSnippet(
  data: Omit<NewSnippet, "id" | "createdAt" | "updatedAt">,
) {
  const now = new Date();
  return db.transaction((tx) => {
    const created = tx
      .insert(snippets)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning()
      .get();
    recordLocalSyncMutation(
      tx,
      "snippet",
      created.id,
      snippetSyncPayload(created),
    );
    return created;
  });
}

export async function getSnippets(
  options: { limit?: number; search?: string } = {},
) {
  const { limit = 100, search } = options;

  if (search) {
    const pattern = `%${search}%`;
    return await db
      .select()
      .from(snippets)
      .where(
        or(like(snippets.trigger, pattern), like(snippets.content, pattern)),
      )
      .orderBy(desc(snippets.createdAt))
      .limit(limit);
  }

  return await db
    .select()
    .from(snippets)
    .orderBy(desc(snippets.createdAt))
    .limit(limit);
}

export async function updateSnippet(
  id: string,
  data: Partial<Omit<Snippet, "id" | "createdAt">>,
) {
  return db.transaction((tx) => {
    const updated = tx
      .update(snippets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(snippets.id, id))
      .returning()
      .get();
    if (!updated) return null;

    recordLocalSyncMutation(
      tx,
      "snippet",
      updated.id,
      snippetSyncPayload(updated),
    );
    return updated;
  });
}

export async function deleteSnippet(id: string) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(snippets)
      .where(eq(snippets.id, id))
      .limit(1)
      .get();
    if (!existing) return null;

    recordLocalSyncMutation(tx, "snippet", existing.id, null);
    const deleted = tx
      .delete(snippets)
      .where(eq(snippets.id, id))
      .returning()
      .get();
    return deleted ?? null;
  });
}
