import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  snippets,
  syncClientState,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  vocabulary,
} from "../../src/db/schema";
import {
  adoptVisibleRows,
  applyPullPages,
  applyPushResults,
  beginUserSyncSession,
  capturePushHeads,
  clearSyncState,
  getPullCursors,
  pauseSyncSession,
  prepareVisibleRowsForFullSync,
  recordLocalSyncMutation,
  type CanonicalSyncItem,
  type SyncContext,
} from "../../src/db/sync";
import { bulkImportVocabulary } from "../../src/db/vocabulary";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

type DesktopDatabase = typeof import("../../src/db").db;

async function applyPullPage(
  fence: SyncContext,
  items: CanonicalSyncItem[],
  cursor: number,
  database: DesktopDatabase,
) {
  const collection = items[0]?.collection;
  if (!collection || items.some((item) => item.collection !== collection)) {
    throw new Error("Test pull page must contain exactly one collection");
  }
  return applyPullPages(fence, [{ collection, items, cursor }], database);
}

describe("settings sync durable store", () => {
  let testDb: TestDatabase;
  let database: DesktopDatabase;

  beforeEach(async () => {
    pauseSyncSession();
    testDb = await createTestDatabase();
    database = testDb.db as unknown as DesktopDatabase;
    setTestDatabase(database);
  });

  afterEach(async () => {
    pauseSyncSession();
    await testDb.close();
  });

  it("stores independent cursors for collection pull blocks", async () => {
    const fence = await beginUserSyncSession("user-1", database);

    expect(
      await applyPullPages(
        fence,
        [
          {
            collection: "vocabulary",
            items: [
              {
                collection: "vocabulary",
                syncId: "01010101-0101-4101-8101-010101010101",
                syncVersion: 4,
                payload: { word: "Amical", replacement: null },
              },
            ],
            cursor: 4,
          },
          {
            collection: "snippet",
            items: [
              {
                collection: "snippet",
                syncId: "02020202-0202-4202-8202-020202020202",
                syncVersion: 7,
                payload: { trigger: "sig", content: "Regards" },
              },
            ],
            cursor: 7,
          },
        ],
        database,
      ),
    ).toBe(true);

    expect(await getPullCursors(fence, undefined, database)).toEqual([
      { collection: "vocabulary", cursor: 4 },
      { collection: "snippet", cursor: 7 },
    ]);
  });

  it("keeps signed-out edits local and adopts them on login", async () => {
    const [row] = await database
      .insert(vocabulary)
      .values({ word: "Amical", isReplacement: false })
      .returning();

    await database.transaction(async (tx) => {
      await recordLocalSyncMutation(tx, "vocabulary", row.id, {
        word: row.word,
        replacement: null,
      });
    });
    expect(await database.select().from(syncOutbox)).toEqual([]);

    const fence = await beginUserSyncSession("user-1", database);
    await adoptVisibleRows(fence, database);

    const [sidecar] = await database.select().from(syncItemState);
    const [pending] = await database.select().from(syncOutbox);
    expect(sidecar).toMatchObject({
      scopeType: "user",
      scopeId: "user-1",
      collection: "vocabulary",
      syncId: row.id,
      acceptedSyncVersion: null,
    });
    expect(pending).toMatchObject({
      syncId: sidecar.syncId,
      desiredPayload: { word: "Amical", replacement: null },
      desiredBaseSyncVersion: null,
      desiredSequence: 1,
      headPresent: false,
    });
  });

  it("enqueues authenticated vocabulary imports through the bulk path", async () => {
    await beginUserSyncSession("user-1", database);

    const created = await bulkImportVocabulary([
      { word: "Alpha", isReplacement: false },
      { word: "Beta", isReplacement: false },
    ]);

    expect(created).toHaveLength(2);
    expect(await database.select().from(syncItemState)).toHaveLength(2);
    expect(await database.select().from(syncOutbox)).toHaveLength(2);
  });

  it("keeps a stable identity when the server wins a signed-out key edit", async () => {
    let fence = await beginUserSyncSession("user-1", database);
    const syncId = "77777777-7777-4777-8777-777777777777";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "server-key", content: "Server" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);

    await clearSyncState(database);
    await database
      .update(snippets)
      .set({ trigger: "local-key", content: "Local" })
      .where(eq(snippets.id, row.id));

    fence = await beginUserSyncSession("user-1", database);
    await prepareVisibleRowsForFullSync(fence, database);
    await adoptVisibleRows(fence, database);
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "server-key", content: "Server" },
        },
      ],
      1,
      database,
    );
    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect(await database.select().from(snippets)).toEqual([
      expect.objectContaining({
        id: syncId,
        trigger: "server-key",
        content: "Server",
      }),
    ]);
    expect((await database.select().from(syncItemState))[0]).toMatchObject({
      syncId,
      acceptedSyncVersion: 1,
    });
  });

  it("lets the server win a same-key signed-out edit", async () => {
    let fence = await beginUserSyncSession("user-1", database);
    const syncId = "88888888-8888-4888-8888-888888888888";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);

    await clearSyncState(database);
    await database
      .update(snippets)
      .set({ content: "Local" })
      .where(eq(snippets.id, row.id));

    fence = await beginUserSyncSession("user-1", database);
    await prepareVisibleRowsForFullSync(fence, database);
    await adoptVisibleRows(fence, database);
    expect((await database.select().from(syncOutbox))[0]).toMatchObject({
      syncId,
      desiredBaseSyncVersion: null,
      desiredPayload: { trigger: "sig", content: "Local" },
    });
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );
    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect((await database.select().from(snippets))[0]).toMatchObject({
      trigger: "sig",
      content: "Server",
    });
  });

  it("accepts a changed canonical payload at the same server version", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "89898989-8989-4989-8989-898989898989";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Original" },
        },
      ],
      1,
      database,
    );

    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Canonical" },
        },
      ],
      1,
      database,
    );

    expect((await database.select().from(snippets))[0].content).toBe(
      "Canonical",
    );
    expect((await database.select().from(syncItemState))[0]).toMatchObject({
      acceptedSyncVersion: 1,
      acceptedPayload: { trigger: "sig", content: "Canonical" },
    });
  });

  it("retains a pending local edit when same-version canonical state changes", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "90909090-9090-4090-9090-909090909090";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Original" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "Local edit" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "Local edit",
      });
    });

    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Canonical" },
        },
      ],
      1,
      database,
    );

    expect((await database.select().from(snippets))[0].content).toBe(
      "Local edit",
    );
    expect(await database.select().from(syncOutbox)).toHaveLength(1);
    expect((await database.select().from(syncItemState))[0]).toMatchObject({
      acceptedSyncVersion: 1,
      acceptedPayload: { trigger: "sig", content: "Canonical" },
    });
  });

  it("reuses the row UUID after clearing the previous user's sync state", async () => {
    const syncId = "99999999-9999-4999-8999-999999999999";
    let fence = await beginUserSyncSession("user-2", database);
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 5,
          payload: { trigger: "sig", content: "User 2" },
        },
      ],
      5,
      database,
    );
    const [row] = await database.select().from(snippets);

    await clearSyncState(database);
    fence = await beginUserSyncSession("user-1", database);
    await database
      .update(snippets)
      .set({ content: "Visible device row" })
      .where(eq(snippets.id, row.id));
    await prepareVisibleRowsForFullSync(fence, database);
    await adoptVisibleRows(fence, database);

    const [pending] = await database.select().from(syncOutbox);
    expect(pending).toMatchObject({
      syncId,
      desiredPayload: { trigger: "sig", content: "Visible device row" },
      desiredBaseSyncVersion: null,
    });
    const [head] = await capturePushHeads(fence, database);
    expect(head.headExpectedSyncVersion).toBeNull();
    expect(head.syncId).toBe(row.id);
    expect(await database.select().from(syncItemState)).toEqual([
      expect.objectContaining({
        syncId,
        acceptedSyncVersion: null,
      }),
    ]);
  });

  it("lets the server restore a fresh-login deletion that was not pushed", async () => {
    let fence = await beginUserSyncSession("user-1", database);
    const syncId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);

    await clearSyncState(database);
    await database
      .update(snippets)
      .set({ content: "Signed out" })
      .where(eq(snippets.id, row.id));

    fence = await beginUserSyncSession("user-1", database);
    await prepareVisibleRowsForFullSync(fence, database);
    await database.transaction(async (tx) => {
      await recordLocalSyncMutation(tx, "snippet", row.id, null);
      await tx.delete(snippets).where(eq(snippets.id, row.id));
    });
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );

    expect(await database.select().from(snippets)).toEqual([
      expect.objectContaining({
        id: syncId,
        trigger: "sig",
        content: "Server",
      }),
    ]);
    expect(await database.select().from(syncOutbox)).toEqual([]);
  });

  it("rebuilds fresh login work from the visible row after logout", async () => {
    let fence = await beginUserSyncSession("user-1", database);
    const syncId = "99999999-9999-4999-8999-999999999999";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "Pending" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "Pending",
      });
    });

    await clearSyncState(database);
    await database
      .update(snippets)
      .set({ content: "Latest" })
      .where(eq(snippets.id, row.id));

    fence = await beginUserSyncSession("user-1", database);
    await prepareVisibleRowsForFullSync(fence, database);
    await adoptVisibleRows(fence, database);
    expect((await database.select().from(syncOutbox))[0]).toMatchObject({
      syncId,
      desiredPayload: { trigger: "sig", content: "Latest" },
      desiredBaseSyncVersion: null,
    });
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );

    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect((await database.select().from(snippets))[0].content).toBe("Server");
  });

  it("discards a pending deletion on logout", async () => {
    let fence = await beginUserSyncSession("user-1", database);
    const syncId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "Pending" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "Pending",
      });
    });

    await clearSyncState(database);
    await database.delete(snippets).where(eq(snippets.id, row.id));

    fence = await beginUserSyncSession("user-1", database);
    await prepareVisibleRowsForFullSync(fence, database);
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );

    expect(await database.select().from(snippets)).toEqual([
      expect.objectContaining({ id: syncId, content: "Server" }),
    ]);
    expect(await database.select().from(syncOutbox)).toEqual([]);
  });

  it("does not infer a tombstone from local absence after logout", async () => {
    let fence = await beginUserSyncSession("user-1", database);
    const syncId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);

    await clearSyncState(database);
    await database.delete(snippets).where(eq(snippets.id, row.id));

    fence = await beginUserSyncSession("user-1", database);
    await prepareVisibleRowsForFullSync(fence, database);
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "Server" },
        },
      ],
      1,
      database,
    );

    expect(await database.select().from(snippets)).toEqual([
      expect.objectContaining({ id: syncId, content: "Server" }),
    ]);
    expect(await database.select().from(syncOutbox)).toEqual([]);
  });

  it("freezes a head and chains a newer tail from that exact base", async () => {
    const [row] = await database
      .insert(vocabulary)
      .values({ word: "B", isReplacement: false })
      .returning();
    const fence = await beginUserSyncSession("user-1", database);
    await adoptVisibleRows(fence, database);

    const [head] = await capturePushHeads(fence, database);
    expect(head).toMatchObject({
      headPayload: { word: "B", replacement: null },
      headExpectedSyncVersion: null,
      headSequence: 1,
    });

    await database.transaction(async (tx) => {
      await tx
        .update(vocabulary)
        .set({ word: "C" })
        .where(eq(vocabulary.id, row.id));
      await recordLocalSyncMutation(tx, "vocabulary", row.id, {
        word: "C",
        replacement: null,
      });
    });
    await database.transaction(async (tx) => {
      await tx
        .update(vocabulary)
        .set({ word: "D" })
        .where(eq(vocabulary.id, row.id));
      await recordLocalSyncMutation(tx, "vocabulary", row.id, {
        word: "D",
        replacement: null,
      });
    });
    const [laterRow] = await database
      .insert(snippets)
      .values({ trigger: "later", content: "Later" })
      .returning();
    await database.transaction(async (tx) => {
      await recordLocalSyncMutation(tx, "snippet", laterRow.id, {
        trigger: "later",
        content: "Later",
      });
    });

    let [pending] = await database
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.syncId, head.syncId));
    expect(pending).toMatchObject({
      desiredPayload: { word: "D", replacement: null },
      desiredBaseSyncVersion: null,
      desiredSequence: 2,
      desiredParentHeadSequence: 1,
      desiredParentSyncVersion: null,
      headPayload: { word: "B", replacement: null },
      headExpectedSyncVersion: null,
      headSequence: 1,
    });
    expect(await capturePushHeads(fence, database)).toEqual([head]);

    await applyPushResults(
      fence,
      [head],
      [
        {
          status: "ok",
          syncId: head.syncId,
          syncVersion: 1,
          applied: true,
        },
      ],
      database,
    );

    [pending] = await database
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.syncId, head.syncId));
    expect(pending).toMatchObject({
      desiredPayload: { word: "D", replacement: null },
      desiredBaseSyncVersion: null,
      desiredSequence: 2,
      desiredParentHeadSequence: 1,
      desiredParentSyncVersion: 1,
      headPresent: false,
    });

    const [tailHead, laterHead] = await capturePushHeads(fence, database);
    expect(tailHead).toMatchObject({
      headPayload: { word: "D", replacement: null },
      headExpectedSyncVersion: 1,
      headSequence: 2,
    });
    expect(laterHead).toMatchObject({
      headPayload: { trigger: "later", content: "Later" },
      headExpectedSyncVersion: null,
      headSequence: 3,
    });
  });

  it("applies divergent newer canonical state without rebasing pending work", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "11111111-1111-4111-8111-111111111111";
    expect(
      await applyPullPage(
        fence,
        [
          {
            collection: "snippet",
            syncId,
            syncVersion: 1,
            payload: { trigger: "sig", content: "Server A" },
          },
        ],
        1,
        database,
      ),
    ).toBe(true);

    const [row] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "Local B" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "Local B",
      });
    });
    expect(await database.select().from(syncOutbox)).toHaveLength(1);

    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 2,
          payload: { trigger: "sig", content: "Server C" },
        },
      ],
      2,
      database,
    );

    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect((await database.select().from(snippets))[0].content).toBe(
      "Server C",
    );
    expect((await database.select().from(syncItemState))[0]).toMatchObject({
      acceptedSyncVersion: 2,
      acceptedPayload: { trigger: "sig", content: "Server C" },
    });
  });

  it("clears a head when a version conflict repeats an accepted canonical", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "44444444-4444-4444-8444-444444444444";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "A" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "B" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "B",
      });
    });
    const [head] = await capturePushHeads(fence, database);

    // Models a canonical sidecar advanced by a sibling duplicate-conflict
    // response while this item's own frozen head was still in flight.
    await database
      .update(syncItemState)
      .set({
        acceptedSyncVersion: 2,
        acceptedPayload: { trigger: "sig", content: "C" },
      })
      .where(eq(syncItemState.syncId, syncId));

    await applyPushResults(
      fence,
      [head],
      [
        {
          status: "conflict",
          reason: "version_conflict",
          syncId,
          canonical: {
            collection: "snippet",
            syncId,
            syncVersion: 2,
            payload: { trigger: "sig", content: "C" },
          },
        },
      ],
      database,
    );

    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect((await database.select().from(snippets))[0].content).toBe("C");
  });

  it("accepts a same-version canonical conflict and discards the rejected edit", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "45454545-4545-4545-8545-454545454545";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "A" },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "B" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "B",
      });
    });
    const [head] = await capturePushHeads(fence, database);

    await applyPushResults(
      fence,
      [head],
      [
        {
          status: "conflict",
          reason: "version_conflict",
          syncId,
          canonical: {
            collection: "snippet",
            syncId,
            syncVersion: 1,
            payload: { trigger: "sig", content: "C" },
          },
        },
      ],
      database,
    );

    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect((await database.select().from(snippets))[0].content).toBe("C");
    expect((await database.select().from(syncItemState))[0]).toMatchObject({
      acceptedSyncVersion: 1,
      acceptedPayload: { trigger: "sig", content: "C" },
    });
  });

  it("orders a delete before recreating the same key with a new identity", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "55555555-5555-4555-8555-555555555555";
    await applyPullPage(
      fence,
      [
        {
          collection: "snippet",
          syncId,
          syncVersion: 1,
          payload: { trigger: "sig", content: "original" },
        },
      ],
      1,
      database,
    );
    const [original] = await database.select().from(snippets);
    await database.transaction(async (tx) => {
      await recordLocalSyncMutation(tx, "snippet", original.id, null);
      await tx.delete(snippets).where(eq(snippets.id, original.id));
    });

    const [recreated] = await database
      .insert(snippets)
      .values({ trigger: "sig", content: "recreated" })
      .returning();
    await adoptVisibleRows(fence, database);

    const sidecars = await database.select().from(syncItemState);
    expect(sidecars).toHaveLength(2);
    const recreatedSidecar = sidecars.find(
      (sidecar) => sidecar.syncId === recreated.id,
    );
    expect(recreatedSidecar?.syncId).toBe(recreated.id);
    expect(recreated.id).not.toBe(syncId);

    const heads = await capturePushHeads(fence, database);
    expect(heads).toEqual([
      expect.objectContaining({
        syncId,
        headPayload: null,
        headExpectedSyncVersion: 1,
        headSequence: 1,
      }),
      expect.objectContaining({
        syncId: recreatedSidecar?.syncId,
        headPayload: { trigger: "sig", content: "recreated" },
        headExpectedSyncVersion: null,
        headSequence: 2,
      }),
    ]);
  });

  it("retains tombstone identity after a physical local delete", async () => {
    const fence = await beginUserSyncSession("user-1", database);
    const syncId = "22222222-2222-4222-8222-222222222222";
    await applyPullPage(
      fence,
      [
        {
          collection: "vocabulary",
          syncId,
          syncVersion: 1,
          payload: { word: "delete-me", replacement: null },
        },
      ],
      1,
      database,
    );
    const [row] = await database.select().from(vocabulary);

    await database.transaction(async (tx) => {
      await recordLocalSyncMutation(tx, "vocabulary", row.id, null);
      await tx.delete(vocabulary).where(eq(vocabulary.id, row.id));
    });
    const [head] = await capturePushHeads(fence, database);
    await applyPushResults(
      fence,
      [head],
      [
        {
          status: "ok",
          syncId,
          syncVersion: 2,
          applied: true,
        },
      ],
      database,
    );

    expect(await database.select().from(vocabulary)).toEqual([]);
    expect(await database.select().from(syncOutbox)).toEqual([]);
    expect((await database.select().from(syncItemState))[0]).toMatchObject({
      syncId,
      acceptedSyncVersion: 2,
      acceptedPayload: null,
    });
  });

  it("uses permanent-head cleanup for duplicate-key conflicts", async () => {
    await database
      .insert(snippets)
      .values({ trigger: "sig", content: "Local" });
    const fence = await beginUserSyncSession("user-1", database);
    await adoptVisibleRows(fence, database);
    const [head] = await capturePushHeads(fence, database);
    const winnerSyncId = "33333333-3333-4333-8333-333333333333";

    await applyPushResults(
      fence,
      [head],
      [
        {
          status: "conflict",
          reason: "duplicate_key_conflict",
          syncId: head.syncId,
          canonical: null,
          conflictingItem: {
            collection: "snippet",
            syncId: winnerSyncId,
            syncVersion: 1,
            payload: { trigger: "sig", content: "Server" },
          },
        },
      ],
      database,
    );

    expect(await database.select().from(syncOutbox)).toEqual([]);
    const [canonicalRow] = await database.select().from(snippets);
    expect(canonicalRow).toMatchObject({
      trigger: "sig",
      content: "Server",
    });
    const sidecars = await database.select().from(syncItemState);
    expect(
      sidecars.find((sidecar) => sidecar.syncId === head.syncId),
    ).toMatchObject({
      acceptedSyncVersion: null,
      acceptedPayload: null,
    });
    expect(
      sidecars.find((sidecar) => sidecar.syncId === winnerSyncId),
    ).toMatchObject({
      acceptedSyncVersion: 1,
      acceptedPayload: { trigger: "sig", content: "Server" },
    });
    expect(canonicalRow.id).toBe(winnerSyncId);
  });

  it("keeps a newer tail after its head loses a duplicate-key conflict", async () => {
    const [row] = await database
      .insert(snippets)
      .values({ trigger: "sig", content: "Local A" })
      .returning();
    const fence = await beginUserSyncSession("user-1", database);
    await adoptVisibleRows(fence, database);
    const [head] = await capturePushHeads(fence, database);

    await database.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ content: "Local B" })
        .where(eq(snippets.id, row.id));
      await recordLocalSyncMutation(tx, "snippet", row.id, {
        trigger: "sig",
        content: "Local B",
      });
    });

    const winnerSyncId = "66666666-6666-4666-8666-666666666666";
    await applyPushResults(
      fence,
      [head],
      [
        {
          status: "conflict",
          reason: "duplicate_key_conflict",
          syncId: head.syncId,
          canonical: null,
          conflictingItem: {
            collection: "snippet",
            syncId: winnerSyncId,
            syncVersion: 1,
            payload: { trigger: "sig", content: "Server" },
          },
        },
      ],
      database,
    );

    expect((await database.select().from(snippets))[0]).toMatchObject({
      trigger: "sig",
      content: "Server",
    });
    expect((await database.select().from(syncOutbox))[0]).toMatchObject({
      syncId: head.syncId,
      desiredPayload: { trigger: "sig", content: "Local B" },
      desiredBaseSyncVersion: null,
      desiredSequence: 2,
      desiredParentHeadSequence: null,
      desiredParentSyncVersion: null,
      headPresent: false,
    });

    const [tailHead] = await capturePushHeads(fence, database);
    expect(tailHead).toMatchObject({
      syncId: head.syncId,
      headPayload: { trigger: "sig", content: "Local B" },
      headExpectedSyncVersion: null,
      headSequence: 2,
    });
  });

  it("ignores an old account response after sync state is reset", async () => {
    const [row] = await database
      .insert(snippets)
      .values({ trigger: "x", content: "device" })
      .returning();
    const userOne = await beginUserSyncSession("user-1", database);
    await adoptVisibleRows(userOne, database);
    const [oldHead] = await capturePushHeads(userOne, database);

    await clearSyncState(database);
    const userTwo = await beginUserSyncSession("user-2", database);
    await adoptVisibleRows(userTwo, database);

    expect(
      await applyPushResults(
        userOne,
        [oldHead],
        [
          {
            status: "ok",
            syncId: oldHead.syncId,
            syncVersion: 1,
            applied: true,
          },
        ],
        database,
      ),
    ).toBe(false);

    const outboxes = await database.select().from(syncOutbox);
    expect(outboxes.map((pending) => pending.scopeId)).toEqual(["user-2"]);
    const [userTwoHead] = await capturePushHeads(userTwo, database);
    expect(userTwoHead.accountId).toBe("user-2");
    expect(userTwoHead.syncId).toBe(oldHead.syncId);

    const [client] = await database.select().from(syncClientState);
    const cursors = await database
      .select()
      .from(syncCollectionState)
      .where(eq(syncCollectionState.scopeId, "user-2"));
    expect(client.lastOutboxSequence).toBe(1);
    expect(cursors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: "vocabulary", cursor: 0 }),
        expect.objectContaining({ collection: "snippet", cursor: 0 }),
      ]),
    );
    expect((await database.select().from(snippets))[0].id).toBe(row.id);
  });
});
