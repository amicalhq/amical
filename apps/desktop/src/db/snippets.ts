import { eq, desc, like, or } from "drizzle-orm";
import { db } from ".";
import { snippets, type Snippet, type NewSnippet } from "./schema";

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
  const result = await db
    .insert(snippets)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning();
  return result[0];
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
  id: number,
  data: Partial<Omit<Snippet, "id" | "createdAt">>,
) {
  const result = await db
    .update(snippets)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(snippets.id, id))
    .returning();
  return result[0] || null;
}

export async function deleteSnippet(id: number) {
  const result = await db
    .delete(snippets)
    .where(eq(snippets.id, id))
    .returning();
  return result[0] || null;
}
