import { EventEmitter } from "node:events";
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
  syncItemState,
  syncOutbox,
  syncScopeState,
} from "../../src/db/schema";
import {
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
  isAuthenticated = vi.fn(async () => this.state?.isAuthenticated === true);

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
  ) {}

  readonly calls: string[] = [];
  readonly bootstrap = vi.fn(async () => {
    this.calls.push("bootstrap");
    return {
      collections: this.collections,
      maxPushBatch: 100,
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
      cursor: number,
      _limit?: number,
      _signal?: AbortSignal,
      _collections?: readonly ("vocabulary" | "snippet")[],
    ): Promise<SyncPullPage> => {
      this.calls.push("pull");
      const items = [...this.items.values()]
        .filter((item) => item.syncVersion > cursor)
        .sort((left, right) => left.syncVersion - right.syncVersion);
      return {
        items,
        cursor: items.at(-1)?.syncVersion ?? cursor,
        hasMore: false,
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
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
    auth = new FakeAuthService();
    service = null;
  });

  afterEach(async () => {
    await service?.shutdown();
    await testDb.close();
    vi.restoreAllMocks();
  });

  it("clears a stale active account when startup is signed out", async () => {
    auth.state = null;
    await testDb.db
      .insert(syncClientState)
      .values({
        id: 1,
        syncUserScopeId: "stale-user",
        sessionEpoch: 1,
      })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { syncUserScopeId: "stale-user", sessionEpoch: 1 },
      });

    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      new InMemorySyncClient(),
    );
    await service.initialize();

    expect((await testDb.db.select().from(syncClientState))[0]).toMatchObject({
      syncUserScopeId: null,
      sessionEpoch: 2,
    });
  });

  it("resumes an existing account from its saved cursor on startup", async () => {
    await testDb.db
      .insert(syncClientState)
      .values({
        id: 1,
        syncUserScopeId: "user-1",
        sessionEpoch: 4,
      })
      .onConflictDoUpdate({
        target: syncClientState.id,
        set: { syncUserScopeId: "user-1", sessionEpoch: 4 },
      });
    await testDb.db.insert(syncScopeState).values({
      accountId: "user-1",
      scopeType: "user",
      scopeId: "user-1",
      cursor: 7,
      responseEpoch: 3,
    });
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    expect(client.calls).toEqual(["bootstrap", "pull"]);
    expect(client.pull.mock.calls[0][2]).toBe(7);
    expect((await testDb.db.select().from(syncScopeState))[0]).toMatchObject({
      cursor: 7,
    });
  });

  it("preserves the active account binding across clean shutdown", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    await service.shutdown();
    service = null;

    expect((await testDb.db.select().from(syncClientState))[0]).toMatchObject({
      syncUserScopeId: "user-1",
    });
  });

  it("adopts local rows before the first startup pull", async () => {
    await createVocabularyWord({
      word: "Amical",
      isReplacement: false,
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
    expect(client.pull.mock.calls[0][2]).toBe(0);
  });

  it("syncs only collections advertised by bootstrap", async () => {
    await createVocabularyWord({
      word: "Amical",
      isReplacement: false,
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
    expect(client.pull.mock.calls[0][5]).toEqual(["vocabulary"]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([
      expect.objectContaining({ collection: "snippet" }),
    ]);
  });

  it("resets an existing cursor for an explicit login", async () => {
    auth.state = null;
    await testDb.db.insert(syncScopeState).values({
      accountId: "user-1",
      scopeType: "user",
      scopeId: "user-1",
      cursor: 7,
      responseEpoch: 3,
    });
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    auth.state = AUTH_STATE;
    auth.emit("authenticated", AUTH_STATE);
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    expect(client.pull.mock.calls[0][2]).toBe(0);
  });

  it.each([401, 403])(
    "retains durable state and waits for an auth change after HTTP %i",
    async (status) => {
      const row = await createVocabularyWord({
        word: "Before",
        isReplacement: false,
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

      expect((await testDb.db.select().from(syncClientState))[0]).toMatchObject(
        {
          syncUserScopeId: "user-1",
        },
      );
      expect((await testDb.db.select().from(syncOutbox))[0]).toMatchObject({
        accountId: "user-1",
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
      isReplacement: false,
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

  it("durably fences logout before a late pull can apply", async () => {
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
          _cursor: number,
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
    expect((await testDb.db.select().from(syncClientState))[0]).toMatchObject({
      syncUserScopeId: null,
    });

    const syncId = "11111111-1111-4111-8111-111111111111";
    pullState.resolve?.({
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
    });

    await service.shutdown();
    service = null;
    expect(await testDb.db.select().from(snippets)).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
  });

  it("ignores a bootstrap response that arrives after logout", async () => {
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
    await auth.logoutForTest();
    expect(bootstrapState.signal?.aborted).toBe(true);

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
          cursor: number,
        ): Promise<SyncPullPage> => {
          concurrentPulls += 1;
          maxConcurrentPulls = Math.max(maxConcurrentPulls, concurrentPulls);
          if (client.pull.mock.calls.length === 1) {
            await new Promise<void>((resolve) => {
              pullState.release = resolve;
            });
          }
          concurrentPulls -= 1;
          return { items: [], cursor, hasMore: false };
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
