import { EventEmitter } from "node:events";
import { BrowserWindow } from "electron";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthState, AuthService } from "../../src/services/auth-service";
import { SettingsSyncService } from "../../src/services/settings-sync-service";
import {
  SettingsSyncHttpError,
  type SyncBootstrap,
  type SyncPullPage,
  type SyncPushMutation,
} from "../../src/services/settings-sync-client";
import type { CanonicalSyncItem, PushSyncResult } from "../../src/db/sync";
import {
  snippets,
  syncClientState,
  syncCollectionState,
  syncItemState,
  syncOutbox,
  syncScopeState,
  vocabulary,
} from "../../src/db/schema";
import {
  beginUserSyncSession,
  pauseSyncSession,
  reconcileSyncScopes,
} from "../../src/db/sync";
import {
  bulkImportVocabulary,
  createOrganizationVocabularyWord,
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

const USER_BOOTSTRAP_SCOPES = [
  {
    scopeType: "user" as const,
    scopeId: "user-1",
    role: null,
    canWrite: true,
    latestSyncVersion: 0,
  },
];

function organizationBootstrapScope(scopeId: string, canWrite: boolean) {
  return {
    scopeType: "org" as const,
    scopeId,
    role: canWrite ? "admin" : "member",
    canWrite,
    latestSyncVersion: 0,
  };
}

class FakeAuthService extends EventEmitter {
  state: AuthState | null = AUTH_STATE;
  beforeLogout: (() => Promise<void>) | null = null;

  getAuthState = vi.fn(async () => this.state);
  getIdToken = vi.fn(async () => this.state?.idToken ?? null);
  refreshTokenIfNeeded = vi.fn(async () => undefined);

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
  readonly bootstrap = vi.fn(
    (): Effect.Effect<SyncBootstrap, unknown> =>
      Effect.sync(() => {
        this.calls.push("bootstrap");
        return {
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: this.collections,
          maxPushBatch: this.maxPushBatch,
          maxPushBytes: 524288,
          pullLimit: 200,
        };
      }),
  );
  readonly push = vi.fn(
    (mutations: SyncPushMutation[]): Effect.Effect<PushSyncResult[], unknown> =>
      Effect.sync(() => {
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
      }),
  );
  readonly pull = vi.fn(
    (
      _scopeType: "user" | "org",
      _scopeId: string,
      cursors: ReadonlyArray<{
        collection: "vocabulary" | "snippet";
        cursor: number;
      }>,
    ): Effect.Effect<SyncPullPage, unknown> =>
      Effect.sync(() => {
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
      }),
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
    vi.useRealTimers();
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
    let releaseBootstrap!: (value: SyncBootstrap) => void;
    client.bootstrap.mockImplementationOnce(() =>
      Effect.async<SyncBootstrap>((resume) => {
        releaseBootstrap = (value) => resume(Effect.succeed(value));
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
      scopes: USER_BOOTSTRAP_SCOPES,
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

  it("can initialize the same service again after clean shutdown", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    await service.shutdown();
    const firstInitialize = service.initialize();
    const secondInitialize = service.initialize();
    expect(secondInitialize).toBe(firstInitialize);
    await Promise.all([firstInitialize, secondInitialize]);

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
  });

  it("starts a fresh lifecycle when initialization is requested after shutdown", async () => {
    let releaseInitialAuth!: (state: AuthState | null) => void;
    auth.getAuthState
      .mockImplementationOnce(
        () =>
          new Promise<AuthState | null>((resolve) => {
            releaseInitialAuth = resolve;
          }),
      )
      .mockResolvedValue(AUTH_STATE);
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );

    const initialInitialize = service.initialize();
    await vi.waitFor(() => expect(auth.getAuthState).toHaveBeenCalledOnce());
    await service.shutdown();

    const restartedInitialize = service.initialize();
    releaseInitialAuth(AUTH_STATE);
    await Promise.all([initialInitialize, restartedInitialize]);

    expect(restartedInitialize).not.toBe(initialInitialize);
    expect(auth.getAuthState).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
  });

  it("stops a restart requested immediately after clean shutdown", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    await service.shutdown();

    const restartedInitialize = service.initialize();
    const restartedShutdown = service.shutdown();
    await Promise.all([restartedInitialize, restartedShutdown]);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(client.pull).toHaveBeenCalledOnce();
    expect(auth.listenerCount("authenticated")).toBe(0);
    expect(auth.beforeLogout).toBeNull();
  });

  it("cancels a restart queued while shutdown is still running", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    const initialShutdown = service.shutdown();
    const queuedRestart = service.initialize();
    const finalShutdown = service.shutdown();
    await Promise.all([initialShutdown, queuedRestart, finalShutdown]);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(finalShutdown).toBe(initialShutdown);
    expect(client.pull).toHaveBeenCalledOnce();
    expect(auth.listenerCount("authenticated")).toBe(0);
    expect(auth.beforeLogout).toBeNull();
  });

  it("starts one lifecycle when restart is requested during shutdown", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    const stopping = service.shutdown();
    const firstRestart = service.initialize();
    const secondRestart = service.initialize();
    expect(secondRestart).toBe(firstRestart);
    await Promise.all([stopping, firstRestart, secondRestart]);

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    expect(auth.listenerCount("authenticated")).toBe(1);
    expect(auth.beforeLogout).not.toBeNull();
  });

  it("keeps every restart caller pending until shared initialization completes", async () => {
    let releaseRestartAuth!: (state: AuthState | null) => void;
    auth.getAuthState.mockResolvedValueOnce(AUTH_STATE).mockImplementationOnce(
      () =>
        new Promise<AuthState | null>((resolve) => {
          releaseRestartAuth = resolve;
        }),
    );
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    const stopping = service.shutdown();
    const firstRestart = stopping.then(() => service!.initialize());
    const queuedRestart = service.initialize();
    let queuedRestartSettled = false;
    void queuedRestart.then(() => {
      queuedRestartSettled = true;
    });

    await stopping;
    await vi.waitFor(() => expect(auth.getAuthState).toHaveBeenCalledTimes(2));
    expect(queuedRestartSettled).toBe(false);

    releaseRestartAuth(AUTH_STATE);
    await Promise.all([firstRestart, queuedRestart]);
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
  });

  it("resumes a pending outbox after restart without logout", async () => {
    await createVocabularyWord({
      word: "Pending",
    });
    const unavailableClient = {
      bootstrap: vi.fn(() => Effect.fail(new Error("offline"))),
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
    await vi.waitFor(() => {
      expect(resumedClient.push).toHaveBeenCalledOnce();
      expect(resumedClient.pull).toHaveBeenCalledOnce();
    });

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

  it("ignores token refresh until explicit login binding is active", async () => {
    auth.state = null;
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    auth.state = AUTH_STATE;
    auth.emit("authenticated", AUTH_STATE);
    auth.emit("token-refreshed", AUTH_STATE);

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    expect(client.bootstrap).toHaveBeenCalledOnce();
  });

  it("ignores a same-turn wake while token refresh is rebinding sync", async () => {
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    auth.emit("token-refreshed", AUTH_STATE);
    service.wake();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
    expect(client.pull).toHaveBeenCalledTimes(2);
  });

  it("retains organization state and requests reauthentication after HTTP 401", async () => {
    let rejectBootstrap = false;
    const client = {
      bootstrap: vi.fn(() =>
        Effect.try({
          try: (): SyncBootstrap => {
            if (rejectBootstrap) {
              throw new SettingsSyncHttpError("Request rejected", 401);
            }
            return {
              scopes: [
                ...USER_BOOTSTRAP_SCOPES,
                organizationBootstrapScope("org-1", true),
              ],
              collections: ["vocabulary", "snippet"],
              maxPushBatch: 100,
              maxPushBytes: 524288,
              pullLimit: 200,
            };
          },
          catch: (error) => error,
        }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          } satisfies SyncPullPage),
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));

    const row = await createOrganizationVocabularyWord({ word: "Keep" });
    rejectBootstrap = true;
    auth.emit("token-refreshed", AUTH_STATE);
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(auth.refreshTokenIfNeeded).toHaveBeenCalledWith(true),
    );

    expect(await testDb.db.select().from(vocabulary)).toEqual([
      expect.objectContaining({ id: row.id, scopeId: "org-1" }),
    ]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([
      expect.objectContaining({
        scopeType: "org",
        scopeId: "org-1",
        syncId: row.id,
      }),
    ]);
    service.wake();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("purges persisted organization state after bootstrap HTTP 403", async () => {
    const personal = await createVocabularyWord({ word: "Personal" });
    await beginUserSyncSession("user-1");
    await reconcileSyncScopes("user-1", [
      ...USER_BOOTSTRAP_SCOPES,
      organizationBootstrapScope("org-1", true),
    ]);
    const organization = await createOrganizationVocabularyWord({
      word: "Organization",
    });
    pauseSyncSession();

    const client = {
      bootstrap: vi.fn(() =>
        Effect.fail(new SettingsSyncHttpError("Forbidden", 403)),
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
    await vi.waitFor(async () => {
      expect(
        (await testDb.db.select().from(vocabulary)).filter(
          (row) => row.scopeType === "org",
        ),
      ).toEqual([]);
    });

    expect(await testDb.db.select().from(vocabulary)).toEqual([
      expect.objectContaining({ id: personal.id, scopeType: "user" }),
    ]);
    expect(await testDb.db.select().from(syncOutbox)).not.toContainEqual(
      expect.objectContaining({ syncId: organization.id }),
    );
    expect(
      (await testDb.db.select().from(syncCollectionState)).filter(
        (row) => row.scopeType === "org",
      ),
    ).toEqual([]);
    expect(
      (await testDb.db.select().from(syncScopeState)).filter(
        (row) => row.scopeType === "org",
      ),
    ).toEqual([]);
    expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();
  });

  it("ignores an in-flight HTTP 401 that completes after token refresh", async () => {
    const firstBootstrap: {
      reject?: (error: Error) => void;
      interrupted?: boolean;
    } = {};
    const client = {
      bootstrap: vi.fn(() => {
        if (client.bootstrap.mock.calls.length === 1) {
          return Effect.async<SyncBootstrap, Error>((resume) => {
            firstBootstrap.reject = (error) => resume(Effect.fail(error));
            return Effect.sync(() => {
              firstBootstrap.interrupted = true;
            });
          });
        }
        return Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"] as Array<
            "vocabulary" | "snippet"
          >,
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        });
      }),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          } satisfies SyncPullPage),
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());

    auth.emit("token-refreshed", AUTH_STATE);
    await vi.waitFor(() => expect(firstBootstrap.interrupted).toBe(true));
    firstBootstrap.reject?.(new SettingsSyncHttpError("Stale token", 401));

    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();
  });

  it.each([
    { status: 401, retained: true },
    { status: 403, retained: false },
  ])(
    "handles organization pull HTTP $status without conflating authentication and access loss",
    async ({ status, retained }) => {
      let rejectOrganizationPull = false;
      const syncId = "11111111-1111-4111-8111-111111111111";
      const client = {
        bootstrap: vi.fn(
          (): Effect.Effect<SyncBootstrap> =>
            Effect.succeed({
              scopes: [
                ...USER_BOOTSTRAP_SCOPES,
                organizationBootstrapScope("org-1", true),
              ],
              collections: ["vocabulary", "snippet"],
              maxPushBatch: 100,
              maxPushBytes: 524288,
              pullLimit: 200,
            }),
        ),
        pull: vi.fn(
          (
            scopeType: "user" | "org",
            _scopeId: string,
            cursors: ReadonlyArray<{
              collection: "vocabulary" | "snippet";
              cursor: number;
            }>,
          ) =>
            Effect.try({
              try: (): SyncPullPage => {
                if (scopeType === "org" && rejectOrganizationPull) {
                  throw new SettingsSyncHttpError("Scope rejected", status);
                }
                return {
                  collections: cursors.map(({ collection, cursor }) => ({
                    collection,
                    items:
                      scopeType === "org" &&
                      collection === "vocabulary" &&
                      cursor === 0
                        ? [
                            {
                              collection,
                              syncId,
                              syncVersion: 1,
                              payload: {
                                word: "Organization",
                                replacement: null,
                              },
                            },
                          ]
                        : [],
                    cursor:
                      scopeType === "org" &&
                      collection === "vocabulary" &&
                      cursor === 0
                        ? 1
                        : cursor,
                    hasMore: false,
                  })),
                };
              },
              catch: (error) => error,
            }),
        ),
        push: vi.fn(),
      };
      service = SettingsSyncService.createForTests(
        auth as unknown as AuthService,
        client,
      );
      await service.initialize();
      await vi.waitFor(() => {
        expect(testDb.db.select().from(vocabulary).all()).toEqual([
          expect.objectContaining({ id: syncId, scopeId: "org-1" }),
        ]);
      });

      rejectOrganizationPull = true;
      service.wake();
      await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(4));
      await vi.waitFor(() => {
        expect(
          testDb.db
            .select()
            .from(vocabulary)
            .all()
            .some((row) => row.id === syncId),
        ).toBe(retained);
      });

      if (status === 401) {
        expect(auth.refreshTokenIfNeeded).toHaveBeenCalledWith(true);
      } else {
        expect(auth.refreshTokenIfNeeded).not.toHaveBeenCalled();
      }
    },
  );

  it("revalidates bootstrap before syncing later edits", async () => {
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
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
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

  it("activates organization sync and applies advertised write capability", async () => {
    let canWrite = false;
    let version = 0;
    const client = {
      bootstrap: vi.fn(
        (): Effect.Effect<SyncBootstrap> =>
          Effect.succeed({
            scopes: [
              ...USER_BOOTSTRAP_SCOPES,
              organizationBootstrapScope("org-1", canWrite),
            ],
            collections: ["vocabulary", "snippet"],
            maxPushBatch: 100,
            maxPushBytes: 524288,
            pullLimit: 200,
          }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          } satisfies SyncPullPage),
      ),
      push: vi.fn((mutations: SyncPushMutation[]) =>
        Effect.sync(() =>
          mutations.map((mutation) => ({
            status: "ok" as const,
            syncId: mutation.syncId,
            syncVersion: ++version,
            applied: true,
          })),
        ),
      ),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    expect(client.pull.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["user", "user-1"],
      ["org", "org-1"],
    ]);
    await expect(
      createOrganizationVocabularyWord({ word: "Blocked" }),
    ).rejects.toThrow("read-only");
    expect(client.push).not.toHaveBeenCalled();

    canWrite = true;
    auth.emit("token-refreshed", AUTH_STATE);
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(4));
    const row = await createOrganizationVocabularyWord({ word: "Published" });
    await vi.waitFor(() => expect(client.push).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(client.push.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        scopeType: "org",
        scopeId: "org-1",
        syncId: row.id,
      }),
    ]);
  });

  it("revalidates a rejected organization push and keeps advertised read access", async () => {
    let canWrite = true;
    const client = {
      bootstrap: vi.fn(
        (): Effect.Effect<SyncBootstrap> =>
          Effect.succeed({
            scopes: [
              ...USER_BOOTSTRAP_SCOPES,
              organizationBootstrapScope("org-1", canWrite),
            ],
            collections: ["vocabulary", "snippet"],
            maxPushBatch: 100,
            maxPushBytes: 524288,
            pullLimit: 200,
          }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          } satisfies SyncPullPage),
      ),
      push: vi.fn((mutations: SyncPushMutation[]) =>
        Effect.sync(() => {
          canWrite = false;
          return mutations.map((mutation) => ({
            status: "error" as const,
            syncId: mutation.syncId,
            reason: "unauthorized_scope" as const,
            message: "Role can no longer write",
          }));
        }),
      ),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));

    const row = await createOrganizationVocabularyWord({ word: "Rejected" });
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(3), {
      timeout: 2_000,
    });
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(5));

    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);
    expect(await testDb.db.select().from(vocabulary)).not.toContainEqual(
      expect.objectContaining({ id: row.id }),
    );
    expect(await testDb.db.select().from(syncScopeState)).toContainEqual(
      expect.objectContaining({
        scopeType: "org",
        scopeId: "org-1",
        canWrite: false,
      }),
    );
    await expect(
      createOrganizationVocabularyWord({ word: "Still blocked" }),
    ).rejects.toThrow("read-only");
  });

  it("revalidates a rejected organization push and purges lost access", async () => {
    let organizationAvailable = true;
    const client = {
      bootstrap: vi.fn(
        (): Effect.Effect<SyncBootstrap> =>
          Effect.succeed({
            scopes: [
              ...USER_BOOTSTRAP_SCOPES,
              ...(organizationAvailable
                ? [organizationBootstrapScope("org-1", true)]
                : []),
            ],
            collections: ["vocabulary", "snippet"],
            maxPushBatch: 100,
            maxPushBytes: 524288,
            pullLimit: 200,
          }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          } satisfies SyncPullPage),
      ),
      push: vi.fn((mutations: SyncPushMutation[]) =>
        Effect.sync(() => {
          organizationAvailable = false;
          return mutations.map((mutation) => ({
            status: "error" as const,
            syncId: mutation.syncId,
            reason: "unauthorized_scope" as const,
            message: "Organization access was removed",
          }));
        }),
      ),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));

    await createOrganizationVocabularyWord({ word: "Remove" });
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(3), {
      timeout: 2_000,
    });
    await vi.waitFor(() => {
      expect(
        testDb.db
          .select()
          .from(syncScopeState)
          .all()
          .filter((row) => row.scopeType === "org"),
      ).toEqual([]);
    });

    expect(
      (await testDb.db.select().from(vocabulary)).filter(
        (row) => row.scopeType === "org",
      ),
    ).toEqual([]);
    expect(
      (await testDb.db.select().from(syncOutbox)).filter(
        (row) => row.scopeType === "org",
      ),
    ).toEqual([]);
  });

  it("purges the previous organization on switch and access loss", async () => {
    let organizationId: string | null = "org-1";
    const remoteIds = {
      "org-1": "11111111-1111-4111-8111-111111111111",
      "org-2": "22222222-2222-4222-8222-222222222222",
    } as const;
    const client = {
      bootstrap: vi.fn(
        (): Effect.Effect<SyncBootstrap> =>
          Effect.succeed({
            scopes: [
              ...USER_BOOTSTRAP_SCOPES,
              ...(organizationId
                ? [organizationBootstrapScope(organizationId, true)]
                : []),
            ],
            collections: ["vocabulary", "snippet"],
            maxPushBatch: 100,
            maxPushBytes: 524288,
            pullLimit: 200,
          }),
      ),
      pull: vi.fn(
        (
          scopeType: "user" | "org",
          scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => {
              if (
                scopeType === "org" &&
                collection === "vocabulary" &&
                cursor === 0
              ) {
                const id = remoteIds[scopeId as keyof typeof remoteIds];
                return {
                  collection,
                  items: [
                    {
                      collection,
                      syncId: id,
                      syncVersion: 1,
                      payload: { word: scopeId, replacement: null },
                    },
                  ],
                  cursor: 1,
                  hasMore: false,
                };
              }
              return { collection, items: [], cursor, hasMore: false };
            }),
          } satisfies SyncPullPage),
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => {
      expect(testDb.db.select().from(vocabulary).all()).toEqual([
        expect.objectContaining({ scopeId: "org-1", word: "org-1" }),
      ]);
    });

    await createOrganizationVocabularyWord({ word: "Queued for org 1" });
    organizationId = "org-2";
    auth.emit("token-refreshed", AUTH_STATE);
    await vi.waitFor(() => {
      expect(testDb.db.select().from(vocabulary).all()).toEqual([
        expect.objectContaining({ scopeId: "org-2", word: "org-2" }),
      ]);
    });
    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);

    organizationId = null;
    auth.emit("token-refreshed", AUTH_STATE);
    await vi.waitFor(() => {
      expect(testDb.db.select().from(vocabulary).all()).toEqual([]);
      expect(
        testDb.db
          .select()
          .from(syncCollectionState)
          .all()
          .filter((row) => row.scopeType === "org"),
      ).toEqual([]);
    });
  });

  it("fences an in-flight organization pull before switching organizations", async () => {
    let organizationId = "org-1";
    const oldPull: {
      resolve?: (page: SyncPullPage) => void;
      interrupted?: boolean;
    } = {};
    const client = {
      bootstrap: vi.fn(
        (): Effect.Effect<SyncBootstrap> =>
          Effect.succeed({
            scopes: [
              ...USER_BOOTSTRAP_SCOPES,
              organizationBootstrapScope(organizationId, true),
            ],
            collections: ["vocabulary", "snippet"],
            maxPushBatch: 100,
            maxPushBytes: 524288,
            pullLimit: 200,
          }),
      ),
      pull: vi.fn(
        (
          scopeType: "user" | "org",
          scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) => {
          if (scopeType === "org" && scopeId === "org-1") {
            return Effect.async<SyncPullPage>((resume) => {
              oldPull.resolve = (page) => resume(Effect.succeed(page));
              return Effect.sync(() => {
                oldPull.interrupted = true;
              });
            });
          }
          return Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
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
    await vi.waitFor(() => expect(oldPull.resolve).toBeDefined());

    organizationId = "org-2";
    auth.emit("token-refreshed", AUTH_STATE);
    await vi.waitFor(() => expect(oldPull.interrupted).toBe(true));
    oldPull.resolve?.({
      collections: [
        {
          collection: "vocabulary",
          items: [
            {
              collection: "vocabulary",
              syncId: "11111111-1111-4111-8111-111111111111",
              syncVersion: 1,
              payload: { word: "Old organization", replacement: null },
            },
          ],
          cursor: 1,
          hasMore: false,
        },
        {
          collection: "snippet",
          items: [],
          cursor: 0,
          hasMore: false,
        },
      ],
    });

    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(
        testDb.db
          .select()
          .from(syncScopeState)
          .all()
          .filter((row) => row.scopeType === "org"),
      ).toEqual([expect.objectContaining({ scopeId: "org-2" })]);
    });
    expect(await testDb.db.select().from(vocabulary)).toEqual([]);
  });

  it("clears sync state and ignores a pull response after logout", async () => {
    const pullState: {
      resolve?: (page: SyncPullPage) => void;
      interrupted?: boolean;
    } = {};
    const client = {
      bootstrap: vi.fn(() =>
        Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"] as Array<
            "vocabulary" | "snippet"
          >,
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        }),
      ),
      pull: vi.fn(() =>
        Effect.async<SyncPullPage>((resume) => {
          pullState.resolve = (page) => resume(Effect.succeed(page));
          return Effect.sync(() => {
            pullState.interrupted = true;
          });
        }),
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();

    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    await testDb.db.insert(vocabulary).values([
      { word: "Personal", scopeType: "user", scopeId: "" },
      {
        word: "Organization",
        scopeType: "org",
        scopeId: "org-1",
      },
    ]);
    await auth.logoutForTest();
    expect(pullState.interrupted).toBe(true);
    expect(await testDb.db.select().from(syncClientState)).toEqual([]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);
    expect(await testDb.db.select().from(vocabulary)).toEqual([
      expect.objectContaining({ word: "Personal", scopeType: "user" }),
    ]);

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

  it("falls back to direct cleanup if the supervisor stops before logout", async () => {
    const client = {
      bootstrap: vi.fn(
        (): Effect.Effect<SyncBootstrap> =>
          Effect.succeed({
            scopes: [
              ...USER_BOOTSTRAP_SCOPES,
              organizationBootstrapScope("org-1", true),
            ],
            collections: ["vocabulary", "snippet"],
            maxPushBatch: 100,
            maxPushBytes: 524288,
            pullLimit: 200,
          }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.succeed({
            collections: cursors.map(({ collection, cursor }) => ({
              collection,
              items: [],
              cursor,
              hasMore: false,
            })),
          } satisfies SyncPullPage),
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    await testDb.db.insert(vocabulary).values([
      { word: "Personal", scopeType: "user", scopeId: "" },
      { word: "Organization", scopeType: "org", scopeId: "org-1" },
    ]);

    const internal = service as unknown as {
      handleEvent: (...args: unknown[]) => Effect.Effect<never>;
    };
    const handleEvent = vi
      .spyOn(internal, "handleEvent")
      .mockReturnValueOnce(Effect.interrupt);
    service.wake();
    await vi.waitFor(() => expect(handleEvent).toHaveBeenCalled());

    await auth.logoutForTest();

    expect(await testDb.db.select().from(vocabulary)).toEqual([
      expect.objectContaining({ word: "Personal", scopeType: "user" }),
    ]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual([]);
    expect(await testDb.db.select().from(syncScopeState)).toEqual([]);
  });

  it("ignores a bootstrap response that arrives after logout", async () => {
    const row = await createVocabularyWord({
      word: "Keep local",
    });
    const bootstrapState: {
      resolve?: (value: SyncBootstrap) => void;
      interrupted?: boolean;
    } = {};
    const client = {
      bootstrap: vi.fn(() =>
        Effect.async<SyncBootstrap>((resume) => {
          bootstrapState.resolve = (value) => resume(Effect.succeed(value));
          return Effect.sync(() => {
            bootstrapState.interrupted = true;
          });
        }),
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
    expect(await testDb.db.select().from(syncOutbox)).toHaveLength(1);
    await auth.logoutForTest();
    expect(bootstrapState.interrupted).toBe(true);
    expect(await testDb.db.select().from(syncClientState)).toEqual([]);
    expect(await testDb.db.select().from(syncCollectionState)).toEqual([]);
    expect(await testDb.db.select().from(syncItemState)).toEqual([]);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([]);
    expect(await testDb.db.select().from(vocabulary)).toEqual([
      expect.objectContaining({ id: row.id, word: "Keep local" }),
    ]);

    bootstrapState.resolve?.({
      scopes: USER_BOOTSTRAP_SCOPES,
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
      bootstrap: vi.fn(() =>
        Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"] as Array<
            "vocabulary" | "snippet"
          >,
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.sync((): SyncPullPage => {
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
          }),
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
      bootstrap: vi.fn(() =>
        Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"] as Array<
            "vocabulary" | "snippet"
          >,
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        }),
      ),
      pull: vi
        .fn()
        .mockReturnValueOnce(
          Effect.succeed({
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
          } satisfies SyncPullPage),
        )
        .mockReturnValueOnce(Effect.fail(new Error("pull failed"))),
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

  it("waits for another wake after a failed attempt", async () => {
    const client = new InMemorySyncClient();
    client.bootstrap
      .mockReturnValueOnce(Effect.fail(new Error("offline")))
      .mockReturnValueOnce(
        Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"],
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        }),
      );
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(client.bootstrap).toHaveBeenCalledOnce();

    service.wake();
    await vi.waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
  });

  it("notifies renderers after logout cleanup", async () => {
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { send },
      } as unknown as BrowserWindow,
    ]);
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    send.mockClear();

    await auth.logoutForTest();

    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith("settings-sync-updated"),
    );
  });

  it("keeps the original poll phase across token refresh", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    const elapsed = Date.now() - startedAt;
    await vi.advanceTimersByTimeAsync(5 * 60_000 - elapsed - 1);
    expect(client.bootstrap).toHaveBeenCalledOnce();

    auth.emit("token-refreshed", AUTH_STATE);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.bootstrap).toHaveBeenCalledTimes(3);
  });

  it("resets the edit debounce and cancels it on shutdown", async () => {
    vi.useFakeTimers();
    const client = new InMemorySyncClient();
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());

    const row = await createVocabularyWord({ word: "First" });
    await vi.advanceTimersByTimeAsync(500);
    await updateVocabulary(row.id, { word: "Second" });
    await vi.advanceTimersByTimeAsync(749);
    expect(client.bootstrap).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));

    await updateVocabulary(row.id, { word: "Pending at shutdown" });
    await vi.advanceTimersByTimeAsync(0);
    await service.shutdown();
    await vi.advanceTimersByTimeAsync(750);

    expect(client.bootstrap).toHaveBeenCalledTimes(2);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([
      expect.objectContaining({ syncId: row.id }),
    ]);
  });

  it("interrupts a pending pull and preserves durable state on shutdown", async () => {
    let pullInterrupted = false;
    const client = {
      bootstrap: vi.fn(() =>
        Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"] as Array<
            "vocabulary" | "snippet"
          >,
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        }),
      ),
      pull: vi.fn(() =>
        Effect.async<SyncPullPage>(() =>
          Effect.sync(() => {
            pullInterrupted = true;
          }),
        ),
      ),
      push: vi.fn(),
    };
    service = SettingsSyncService.createForTests(
      auth as unknown as AuthService,
      client,
    );
    await service.initialize();
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledOnce());
    const row = await createVocabularyWord({ word: "Pending" });

    await service.shutdown();

    expect(pullInterrupted).toBe(true);
    expect(await testDb.db.select().from(syncClientState)).toHaveLength(1);
    expect(await testDb.db.select().from(syncOutbox)).toEqual([
      expect.objectContaining({ syncId: row.id }),
    ]);
  });

  it("coalesces wakes so only one pull is in flight", async () => {
    let concurrentPulls = 0;
    let maxConcurrentPulls = 0;
    const pullState: { release?: () => void } = {};
    const client = {
      bootstrap: vi.fn(() =>
        Effect.succeed({
          scopes: USER_BOOTSTRAP_SCOPES,
          collections: ["vocabulary", "snippet"] as Array<
            "vocabulary" | "snippet"
          >,
          maxPushBatch: 100,
          maxPushBytes: 524288,
          pullLimit: 200,
        }),
      ),
      pull: vi.fn(
        (
          _scopeType: "user" | "org",
          _scopeId: string,
          cursors: ReadonlyArray<{
            collection: "vocabulary" | "snippet";
            cursor: number;
          }>,
        ) =>
          Effect.gen(function* () {
            concurrentPulls += 1;
            maxConcurrentPulls = Math.max(maxConcurrentPulls, concurrentPulls);
            if (client.pull.mock.calls.length === 1) {
              yield* Effect.async<void>((resume) => {
                pullState.release = () => resume(Effect.void);
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
          }),
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
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(client.pull).toHaveBeenCalledTimes(2);
    expect(maxConcurrentPulls).toBe(1);
  });
});
