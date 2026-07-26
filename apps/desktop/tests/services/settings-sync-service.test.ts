import { EventEmitter } from "node:events";
import { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthState, AuthService } from "../../src/services/auth-service";
import { SettingsSyncService } from "../../src/services/settings-sync-service";
import {
  SettingsSyncHttpError,
  type SyncPullPage,
  type SyncPushMutation,
} from "../../src/services/settings-sync-client";
import type { CanonicalSyncItem } from "../../src/db/sync";
import {
  snippets,
  syncClientState,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  vocabulary,
} from "../../src/db/schema";
import { pauseSyncSession } from "../../src/db/sync";
import {
  bulkImportVocabulary,
  createVocabularyWord,
  updateVocabulary,
} from "../../src/db/vocabulary";
import { createSnippet } from "../../src/db/snippets";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

const AUTH_STATE: AuthState = {
  isAuthenticated: true,
  idToken: "id-token",
  refreshToken: "refresh-token",
  accessToken: "access-token",
  expiresAt: Date.now() + 60_000,
  userInfo: { sub: "user-1" },
};

class FakeAuthService extends EventEmitter {
  state: AuthState | null = AUTH_STATE;
  beforeLogout: (() => Promise<void>) | null = null;

  getAuthState = vi.fn(async () => this.state);
  getIdToken = vi.fn(async () => this.state?.idToken ?? null);

  registerBeforeLogoutHandler(handler: () => Promise<void>): () => void {
    this.beforeLogout = handler;
    return () => {
      if (this.beforeLogout === handler) this.beforeLogout = null;
    };
  }

  async logoutForTest(): Promise<void> {
    await this.beforeLogout?.();
    this.state = null;
    this.emit("logged-out");
  }
}

class InMemorySyncClient {
  constructor(
    private readonly collections: Array<"vocabulary" | "snippet"> = [
      "vocabulary",
      "snippet",
    ],
    private readonly maxPushBatch = 100,
  ) {}

  readonly calls: string[] = [];
  readonly bootstrap = vi.fn(async () => {
    this.calls.push("bootstrap");
    return {
      collections: this.collections,
      maxPushBatch: this.maxPushBatch,
      maxPushBytes: 524288,
      pullLimit: 200,
    };
  });
  readonly push = vi.fn(async (mutations: SyncPushMutation[]) => {
    this.calls.push("push");
    return mutations.map((mutation) => {
      this.version += 1;
      this.items.set(mutation.syncId, {
        collection: mutation.collection,
        syncId: mutation.syncId,
        syncVersion: this.version,
        payload: mutation.payload,
      });
      return {
        status: "ok" as const,
        syncId: mutation.syncId,
        syncVersion: this.version,
        applied: true,
      };
    });
  });
  readonly pull = vi.fn(
    async (
      _scopeType: "user" | "org",
      _scopeId: string,
      cursors: ReadonlyArray<{
        collection: "vocabulary" | "snippet";
        cursor: number;
      }>,
      _limit?: number,
      _signal?: AbortSignal,
    ): Promise<SyncPullPage> => {
      this.calls.push("pull");
      return {
        collections: cursors.map(({ collection, cursor }) => {
          const items = [...this.items.values()]
            .filter(
              (item) =>
                item.collection === collection && item.syncVersion > cursor,
            )
            .sort((left, right) => left.syncVersion - right.syncVersion);
          return {
            collection,
            items,
            cursor: items.at(-1)?.syncVersion ?? cursor,
            hasMore: false,
          };
        }),
      };
    },
  );

  private version = 0;
  private readonly items = new Map<string, CanonicalSyncItem>();
}

describe("SettingsSyncService", () => {
  let testDb: TestDatabase;
  let service: SettingsSyncService | null;
  let auth: FakeAuthService;

  beforeEach(async () => {
    pauseSyncSession();
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    auth = new FakeAuthService();
    service = null;
  });

  afterEach(async () => {
    await service?.shutdown();
    pauseSyncSession();
    await testDb.close();
    vi.restoreAllMocks();
  });

  it("clears stale sync metadata when startup is signed out", async () => {
    auth.state = null;
    await testDb.db
      .insert(syncClientState)
      .values({ id: 1, lastOutboxSequence: 4 })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { lastOutboxSequence: 4 },
      });
    await testDb.db.insert(syncCollectionState).values({
      scopeType: "user",
      scopeId: "stale-user",
      collection: "vocabulary",
      cursor: 3,
    });

    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      new InMemorySyncClient(),
    );
    await service.initialize();

    expect(await testDb.db.select().from(syncClientState)).toEqual([]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual([]);
  });

  it("resumes an existing account from its saved cursor on startup", async () => {
    await testDb.db
      .insert(syncClientState)
      .values({ id: 1, lastOutboxSequence: 4 })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { lastOutboxSequence: 4 },
      });
    await testDb.db.insert(syncCollectionState).values([
      {
        scopeType: "user",
        scopeId: "user-1",
        collection: "vocabulary",
        cursor: 7,
      },
      {
        scopeType: "user",
        scopeId: "user-1",
        collection: "snippet",
        cursor: 5,
      },
    ]);
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    expect(client.calls).toEqual(["bootstrap", "pull"]);
    expect(client.pull.mock.calls[0][2]).toEqual([
      { collection: "vocabulary", cursor: 7 },
      { collection: "snippet", cursor: 5 },
    ]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: "vocabulary", cursor: 7 }),
        expect.objectContaining({ collection: "snippet", cursor: 5 }),
      ]),
    );
  });

  it("binds local edits before startup sync I/O completes", async () => {
    const row = await createVocabularyWord({
      word: "Before refresh",
    });
    await testDb.db
      .insert(syncClientState)
      .values({
        id: 1,
        lastOutboxSequence: 0,
      })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { lastOutboxSequence: 0 },
      });
    await testDb.db.insert(syncCollectionState).values([
      {
        scopeType: "user",
        scopeId: "user-1",
        collection: "vocabulary",
        cursor: 1,
      },
      {
        scopeType: "user",
        scopeId: "user-1",
        collection: "snippet",
        cursor: 0,
      },
    ]);
    await testDb.db.insert(syncItemState).values({
      scopeType: "user",
      scopeId: "user-1",
      collection: "vocabulary",
      syncId: row.id,
      acceptedSyncVersion: 1,
      acceptedPayload: { word: "Before refresh", replacement: null },
    });

    const client = new InMemorySyncClient();
    let releaseBootstrap!: (value: {
      collections: Array<"vocabulary" | "snippet">;
      maxPushBatch: number;
      maxPushBytes: number;
      pullLimit: number;
    }) => void;
    client.bootstrap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBootstrap = resolve;
        }),
    );
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    await service.initialize();
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
    await updateVocabulary(row.id, { word: "Edited during refresh" });
    expect((await testDb.db.select().from(syncOutbox))[0]).toMatchObject({
      syncId: row.id,
      desiredBaseSyncVersion: 1,
      desiredPayload: {
        word: "Edited during refresh",
        replacement: null,
      },
    });

    releaseBootstrap({
      collections: ["vocabulary", "snippet"],
      maxPushBatch: 100,
      maxPushBytes: 524288,
      pullLimit: 200,
    });
    await vi.waitFor(() => expect(client.push).toHaveBeenCalledOnce());

    expect(client.push.mock.calls[0][0][0]).toMatchObject({
      syncId: row.id,
      expectedSyncVersion: 1,
      payload: { word: "Edited during refresh", replacement: null },
    });
  });

  it("preserves durable sync progress across clean shutdown", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    await service.shutdown();
    service = null;

    expect(await testDb.db.select().from(syncClientState)).toHaveLength(1);
    expect(await testDb.db.select().from(syncCollectionState)).toHaveLength(2);
  });

  it("resumes a pending outbox after restart without logout", async () => {
    await createVocabularyWord({
      word: "Pending",
    });
    const unavailableClient = {
      bootstrap: vi.fn().mockRejectedValue(new Error("offline")),
      pull: vi.fn(),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      unavailableClient,
    );
    await service.initialize();
    await vi.waitFor(() =>
      expect(unavailableClient.bootstrap).toHaveBeenCalledOnce(),
    );
    expect(await testDb.db.select().from(syncOutbox)).toHaveLength(1);

    await service.shutdown();
    service = null;

    const resumedClient = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      resumedClient,
    );
    await service.initialize();
    await vi.waitFor(() => expect(resumedClient.push).toHaveBeenCalledOnce());

    expect(resumedClient.push.mock.calls[0][0][0]).toMatchObject({
      expectedSyncVersion: null,
      payload: { word: "Pending", replacement: null },
    });
    expect(resumedClient.pull.mock.calls[0][2]).toEqual([
      { collection: "vocabulary", cursor: 0 },
      { collection: "snippet", cursor: 0 },
    ]);
  });

  it("adopts local rows before the first startup pull", async () => {
    await createVocabularyWord({
      word: "Amical",
    });
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    await service.initialize();
    await vi.waitFor(async () => {
      expect(client.push).toHaveBeenCalledOnce();
      expect(await testDb.db.select().from(syncOutbox)).toEqual([]);
    });

    expect(client.calls.slice(0, 3)).toEqual(["bootstrap", "push", "pull"]);
    expect(client.pull.mock.calls[0][2]).toEqual([
      { collection: "vocabulary", cursor: 0 },
      { collection: "snippet", cursor: 0 },
    ]);
  });

  it("syncs only collections advertised by bootstrap", async () => {
    await createVocabularyWord({
      word: "Amical",
    });
    await createSnippet({ trigger: "sig", content: "Regards" });
    const client = new InMemorySyncClient(["vocabulary"]);
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    await service.initialize();
    await vi.waitFor(() => {
      expect(client.push).toHaveBeenCalledOnce();
      expect(client.pull).toHaveBeenCalledOnce();
    });

    expect(client.push.mock.calls[0][0]).toEqual([
      expect.objectContaining({ collection: "vocabulary" }),
    ]);
    expect(client.pull.mock.calls[0][2]).toEqual([
      { collection: "vocabulary", cursor: 0 },
    ]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([
      expect.objectContaining({ collection: "snippet" }),
    ]);
  });

  it("resets an existing cursor for an explicit login", async () => {
    auth.state = null;
    await testDb.db.insert(syncCollectionState).values([
      {
        scopeType: "user",
        scopeId: "user-1",
        collection: "vocabulary",
        cursor: 7,
      },
      {
        scopeType: "user",
        scopeId: "user-1",
        collection: "snippet",
        cursor: 5,
      },
    ]);
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    auth.state = AUTH_STATE;
    auth.emit("authenticated", AUTH_STATE);
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    expect(client.pull.mock.calls[0][2]).toEqual([
      { collection: "vocabulary", cursor: 0 },
      { collection: "snippet", cursor: 0 },
    ]);
  });

  it.each([401, 403])(
    "retains durable state and waits for an auth change after HTTP %i",
    async (status) => {
      const row = await createVocabularyWord({
        word: "Before",
      });
      const client = {
        bootstrap: vi
          .fn()
          .mockRejectedValue(
            new SettingsSyncHttpError("Request rejected", status),
          ),
        pull: vi.fn(),
        push: vi.fn(),
      };
      service = SettingsSyncService.createForTests(
        auth as unknown as AuthService,
        client,
      );
      await service.initialize();
      await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 0));

      await updateVocabulary(row.id, { word: "After" });
      service.wake();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await testDb.db.select().from(syncClientState)).toHaveLength(1);
      expect((await testDb.db.select().from(syncOutbox))[0]).toMatchObject({
        scopeId: "user-1",
        desiredPayload: { word: "After", replacement: null },
      });
      expect(client.bootstrap).toHaveBeenCalledOnce();

      auth.emit("token-refreshed", AUTH_STATE);
      await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(2));
    },
  );

  it("reconciles once at login, then uses incremental sync for edits", async () => {
    auth.state = null;
    const row = await createVocabularyWord({
      word: "Amical",
    });
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    auth.state = AUTH_STATE;
    auth.emit("authenticated", AUTH_STATE);

    await vi.waitFor(async () => {
      expect(client.push).toHaveBeenCalledTimes(1);
      expect(await testDb.db.select().from(syncOutbox)).toEqual([]);
    });
    expect(client.calls.slice(0, 3)).toEqual(["bootstrap", "push", "pull"]);
    expect(client.push.mock.calls[0][0][0]).toMatchObject({
      collection: "vocabulary",
      scopeType: "user",
      scopeId: "user-1",
      expectedSyncVersion: null,
      payload: { word: "Amical", replacement: null },
    });

    await updateVocabulary(row.id, { word: "Amical Desktop" });

    await vi.waitFor(
      () => {
        expect(client.push).toHaveBeenCalledTimes(2);
      },
      { timeout: 2_000 },
    );
    expect(client.bootstrap).toHaveBeenCalledTimes(1);
    expect(client.push.mock.calls[1][0][0]).toMatchObject({
      expectedSyncVersion: 1,
      payload: { word: "Amical Desktop", replacement: null },
    });
  });

  it("preserves durable outbox order across collections", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    await createSnippet({ trigger: "first", content: "First" });
    await createVocabularyWord({
      word: "Second",
    });

    await vi.waitFor(() => expect(client.push).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(client.push.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        collection: "snippet",
        payload: { trigger: "first", content: "First" },
      }),
      expect.objectContaining({
        collection: "vocabulary",
        payload: { word: "Second", replacement: null },
      }),
    ]);
  });

  it("drains every bounded push batch before pulling", async () => {
    await bulkImportVocabulary(
      Array.from({ length: 101 }, (_, index) => ({
        word: `Word ${index}`,
      })),
    );
    const client = new InMemorySyncClient(["vocabulary", "snippet"], 1);
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    await service.initialize();
    await vi.waitFor(
      () => {
        expect(client.push).toHaveBeenCalledTimes(101);
        expect(client.pull).toHaveBeenCalledOnce();
      },
      { timeout: 10_000 },
    );

    expect(client.calls.indexOf("pull")).toBe(102);
    expect(client.calls.at(-1)).toBe("pull");
  });

  it("clears sync state and ignores a pull response after logout", async () => {
    const pullState: {
      resolve?: (page: SyncPullPage) => void;
      signal?: AbortSignal;
    } = {};
    const client = {
      bootstrap: vi.fn().mockResolvedValue({
        collections: ["vocabulary", "snippet"] as Array<
          "vocabulary" | "snippet"
        >,
        maxPushBatch: 100,
        maxPushBytes: 524288,
        pullLimit: 200,
      }),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          _cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
          _limit: number,
          signal: AbortSignal,
        ) => {
          pullState.signal = signal;
          return new Promise<SyncPullPage>((resolve) => {
            pullState.resolve = resolve;
          });
        },
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    await auth.logoutForTest();
    expect(pullState.signal?.aborted).toBe(true);
    expect(await testDb.db.select().from(syncClientState)).toEqual([]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);

    const syncId = "11111111-1111-4111-8111-111111111111";
    pullState.resolve?.({
      collections: [
        {
          collection: "snippet",
          items: [
            {
              collection: "snippet",
              syncId,
              syncVersion: 1,
              payload: { trigger: "sig", content: "late" },
            },
          ],
          cursor: 1,
          hasMore: false,
        },
      ],
    });

    await service.shutdown();
    service = null;
    expect(await testDb.db.select().from(snippets)).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
  });

  it("ignores a bootstrap response that arrives after logout", async () => {
    const row = await createVocabularyWord({
      word: "Keep local",
    });
    const bootstrapState: {
      resolve?: (value: {
        collections: Array<"vocabulary" | "snippet">;
        maxPushBatch: number;
        maxPushBytes: number;
        pullLimit: number;
      }) => void;
      signal?: AbortSignal;
    } = {};
    const client = {
      bootstrap: vi.fn((_accountId: string, signal: AbortSignal) => {
        bootstrapState.signal = signal;
        return new Promise<{
          collections: Array<"vocabulary" | "snippet">;
          maxPushBatch: number;
          maxPushBytes: number;
          pullLimit: number;
        }>((resolve) => {
          bootstrapState.resolve = resolve;
        });
      }),
      pull: vi.fn(),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
    expect(await testDb.db.select().from(syncOutbox)).toHaveLength(1);
    await auth.logoutForTest();
    expect(bootstrapState.signal?.aborted).toBe(true);
    expect(await testDb.db.select().from(syncClientState)).toEqual([]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);
    expect(await testDb.db.select().from(vocabulary)).toEqual([
      expect.objectContaining({ id: row.id, word: "Keep local" }),
    ]);

    bootstrapState.resolve?.({
      collections: ["vocabulary", "snippet"],
      maxPushBatch: 100,
      maxPushBytes: 524288,
      pullLimit: 200,
    });
    await service.shutdown();
    service = null;

    expect(client.push).not.toHaveBeenCalled();
    expect(client.pull).not.toHaveBeenCalled();
  });

  it("sends both collection cursors on every incremental pull page", async () => {
    const syncId = "22222222-2222-4222-8222-222222222222";
    const client = {
      bootstrap: vi.fn().mockResolvedValue({
        collections: ["vocabulary", "snippet"] as Array<
          "vocabulary" | "snippet"
        >,
        maxPushBatch: 100,
        maxPushBytes: 524288,
        pullLimit: 200,
      }),
      pull: vi.fn(
        async (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ): Promise<SyncPullPage> => {
          if (client.pull.mock.calls.length === 1) {
            return {
              collections: [
                {
                  collection: "vocabulary",
                  items: [
                    {
                      collection: "vocabulary",
                      syncId,
                      syncVersion: 1,
                      payload: { word: "Amical", replacement: null },
                    },
                  ],
                  cursor: 1,
                  hasMore: true,
                },
                {
                  collection: "snippet",
                  items: [],
                  cursor: 0,
                  hasMore: false,
                },
              ],
            };
          }
          return {
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          };
        },
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    expect(client.pull.mock.calls[0][2]).toEqual([
      { collection: "vocabulary", cursor: 0 },
      { collection: "snippet", cursor: 0 },
    ]);
    expect(client.pull.mock.calls[1][2]).toEqual([
      { collection: "vocabulary", cursor: 1 },
      { collection: "snippet", cursor: 0 },
    ]);
  });

  it("refreshes renderers when a later pull page fails", async () => {
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([
      {
        isDestroyed: () => false,
        webContents: { send },
      } as unknown as BrowserWindow,
    ]);
    const client = {
      bootstrap: vi.fn().mockResolvedValue({
        collections: ["vocabulary", "snippet"] as Array<
          "vocabulary" | "snippet"
        >,
        maxPushBatch: 100,
        maxPushBytes: 524288,
        pullLimit: 200,
      }),
      pull: vi
        .fn()
        .mockResolvedValueOnce({
          collections: [
            {
              collection: "vocabulary",
              items: [
                {
                  collection: "vocabulary",
                  syncId: "33333333-3333-4333-8333-333333333333",
                  syncVersion: 1,
                  payload: { word: "Amical", replacement: null },
                },
              ],
              cursor: 1,
              hasMore: true,
            },
            {
              collection: "snippet",
              items: [],
              cursor: 0,
              hasMore: false,
            },
          ],
        } satisfies SyncPullPage)
        .mockRejectedValueOnce(new Error("pull failed")),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith("settings-sync-updated"),
    );
  });

  it("coalesces wakes so only one pull is in flight", async () => {
    let concurrentPulls = 0;
    let maxConcurrentPulls = 0;
    const pullState: { release?: () => void } = {};
    const client = {
      bootstrap: vi.fn().mockResolvedValue({
        collections: ["vocabulary", "snippet"] as Array<
          "vocabulary" | "snippet"
        >,
        maxPushBatch: 100,
        maxPushBytes: 524288,
        pullLimit: 200,
      }),
      pull: vi.fn(
        async (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ): Promise<SyncPullPage> => {
          concurrentPulls += 1;
          maxConcurrentPulls = Math.max(maxConcurrentPulls, concurrentPulls);
          if (client.pull.mock.calls.length === 1) {
            await new Promise<void>((resolve) => {
              pullState.release = resolve;
            });
          }
          concurrentPulls -= 1;
          return {
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          };
        },
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    service.wake();
    service.wake();
    service.wake();
    expect(maxConcurrentPulls).toBe(1);

    pullState.release?.();
    await vi.waitFor(() =>
      expect(client.pull.mock.calls.length).toBeGreaterThan(1),
    );
    expect(maxConcurrentPulls).toBe(1);
  });
});
