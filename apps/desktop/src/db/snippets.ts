import { and, eq } from "drizzle-orm";
import { db } from ".";
import { snippets, type Snippet, type NewSnippet } from "./schema";
import {
  getActiveOrganizationAccess,
  getWritableOrganizationIdentity,
  recordLocalSyncMutation,
  recordOrganizationSyncMutation,
  snippetSyncPayload,
} from "./sync";
import type { LanguageAssetScopeFilter } from "./vocabulary";

function effectiveSnippets(rows: Snippet[]): Snippet[] {
  const effective = new Map<string, Snippet>();
  for (const row of [...rows].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const existing = effective.get(row.trigger);
    if (!existing || row.scopeType === "user") effective.set(row.trigger, row);
  }
  return [...effective.values()];
}

async function readableSnippets(rows: Snippet[]): Promise<Snippet[]> {
  const organization = await getActiveOrganizationAccess();
  return rows.filter(
    (row) =>
      (row.scopeType === "user" && row.scopeId === "") ||
      (row.scopeType === "org" && row.scopeId === organization?.scopeId),
  );
}

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
  scopeType: "user" | "org" = "user",
): Promise<Snippet | null> {
  const normalized = trigger.trim().toLowerCase();
  const scopeId =
    scopeType === "user" ? "" : (await getActiveOrganizationAccess())?.scopeId;
  if (scopeId === undefined) return null;
  const all = await db
    .select()
    .from(snippets)
    .where(
      and(eq(snippets.scopeType, scopeType), eq(snippets.scopeId, scopeId)),
    );
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
  return effectiveSnippets(
    await readableSnippets(await db.select().from(snippets)),
  );
}

export async function createSnippet(
  data: Omit<
    NewSnippet,
    "id" | "scopeType" | "scopeId" | "createdAt" | "updatedAt"
  >,
) {
  const now = new Date();
  return db.transaction((tx) => {
    const created = tx
      .insert(snippets)
      .values({
        ...data,
        scopeType: "user",
        scopeId: "",
        createdAt: now,
        updatedAt: now,
      })
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

export async function createOrganizationSnippet(
  data: Omit<
    NewSnippet,
    "id" | "scopeType" | "scopeId" | "createdAt" | "updatedAt"
  >,
) {
  const identity = getWritableOrganizationIdentity();
  if (!identity) throw new Error("Organization language assets are read-only");
  const now = new Date();

  return db.transaction((tx) => {
    const created = tx
      .insert(snippets)
      .values({
        ...data,
        scopeType: "org",
        scopeId: identity.scopeId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    recordOrganizationSyncMutation(
      tx,
      "snippet",
      created.id,
      snippetSyncPayload(created),
    );
    return created;
  });
}

export async function getSnippets(
  options: {
    limit?: number;
    search?: string;
    scope?: LanguageAssetScopeFilter;
  } = {},
) {
  const { limit = 100, search, scope = "all" } = options;
  const searchTerm = search?.toLocaleLowerCase();
  const scopedRows = (
    await readableSnippets(await db.select().from(snippets))
  ).filter(
    (row) =>
      (scope === "all" || row.scopeType === scope) &&
      (!searchTerm ||
        row.trigger.toLocaleLowerCase().includes(searchTerm) ||
        row.content.toLocaleLowerCase().includes(searchTerm)),
  );
  const rows = scope === "all" ? effectiveSnippets(scopedRows) : scopedRows;
  return rows
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

export async function updateSnippet(
  id: string,
  data: Partial<Omit<Snippet, "id" | "scopeType" | "scopeId" | "createdAt">>,
) {
  return db.transaction((tx) => {
    const updated = tx
      .update(snippets)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(snippets.id, id),
          eq(snippets.scopeType, "user"),
          eq(snippets.scopeId, ""),
        ),
      )
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

export async function updateOrganizationSnippet(
  id: string,
  data: Partial<Omit<Snippet, "id" | "scopeType" | "scopeId" | "createdAt">>,
) {
  const identity = getWritableOrganizationIdentity();
  if (!identity) throw new Error("Organization language assets are read-only");

  return db.transaction((tx) => {
    const updated = tx
      .update(snippets)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(snippets.id, id),
          eq(snippets.scopeType, "org"),
          eq(snippets.scopeId, identity.scopeId),
        ),
      )
      .returning()
      .get();
    if (!updated) return null;
    recordOrganizationSyncMutation(
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
      .where(
        and(
          eq(snippets.id, id),
          eq(snippets.scopeType, "user"),
          eq(snippets.scopeId, ""),
        ),
      )
      .limit(1)
      .get();
    if (!existing) return null;

    recordLocalSyncMutation(tx, "snippet", existing.id, null);
    const deleted = tx
      .delete(snippets)
      .where(
        and(
          eq(snippets.id, id),
          eq(snippets.scopeType, "user"),
          eq(snippets.scopeId, ""),
        ),
      )
      .returning()
      .get();
    return deleted ?? null;
  });
}

export async function deleteOrganizationSnippet(id: string) {
  const identity = getWritableOrganizationIdentity();
  if (!identity) throw new Error("Organization language assets are read-only");

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(snippets)
      .where(
        and(
          eq(snippets.id, id),
          eq(snippets.scopeType, "org"),
          eq(snippets.scopeId, identity.scopeId),
        ),
      )
      .limit(1)
      .get();
    if (!existing) return null;
    recordOrganizationSyncMutation(tx, "snippet", existing.id, null);
    return (
      tx
        .delete(snippets)
        .where(
          and(
            eq(snippets.id, id),
            eq(snippets.scopeType, "org"),
            eq(snippets.scopeId, identity.scopeId),
          ),
        )
        .returning()
        .get() ?? null
    );
  });
}
