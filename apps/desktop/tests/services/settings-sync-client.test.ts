import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Fiber } from "effect";

import {
  SettingsSyncPullCollectionRequestSchema,
  SettingsSyncPushRequestSchema,
} from "@amical/types";
import type { AuthService } from "../../src/services/auth-service";
import {
  SettingsSyncClient,
  SettingsSyncHttpError,
} from "../../src/services/settings-sync-client";
import { settleExit } from "../../src/types/errors";

const SYNC_ID = "11111111-1111-4111-8111-111111111111";
const runClient = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then(settleExit);

describe("SettingsSyncClient", () => {
  let client: SettingsSyncClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CORE_API_URL = "https://core.test";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new SettingsSyncClient({
      getIdToken: vi.fn().mockResolvedValue("id-token"),
    } as unknown as AuthService);
  });

  afterEach(() => {
    delete process.env.CORE_API_URL;
    vi.unstubAllGlobals();
  });

  it("validates bootstrap and sends the current bearer token", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopes: [
          {
            scopeType: "user",
            scopeId: "user-1",
            role: null,
            canWrite: true,
            latestSyncVersion: 0,
            displayName: "User",
          },
        ],
        capabilities: {
          collections: ["vocabulary", "snippet", "notes"],
          maxPushBatch: 100,
          maxPushBytes: 524288,
          defaultPullLimit: 600,
          maxPullLimit: 500,
          maxPullBytes: 524288,
          oneScopePerPush: true,
          supportsDeltaCompression: false,
        },
        protocolVersion: 1,
      }),
    });

    await expect(runClient(client.bootstrap("user-1"))).resolves.toEqual({
      scopes: [
        {
          scopeType: "user",
          scopeId: "user-1",
          role: null,
          canWrite: true,
          latestSyncVersion: 0,
        },
      ],
      collections: ["vocabulary", "snippet"],
      maxPushBatch: 100,
      maxPushBytes: 524288,
      pullLimit: 500,
    });

    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(url.toString()).toBe("https://core.test/apps/v1/sync/bootstrap");
    expect(init.headers.Authorization).toBe("Bearer id-token");
  });

  it("returns the active organization scope and advertised write capability", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopes: [
          {
            scopeType: "user",
            scopeId: "user-1",
            role: null,
            canWrite: true,
            latestSyncVersion: 7,
          },
          {
            scopeType: "org",
            scopeId: "org-1",
            role: "member",
            canWrite: false,
            latestSyncVersion: 12,
          },
        ],
        capabilities: {
          collections: ["vocabulary", "snippet"],
          maxPushBatch: 100,
          maxPushBytes: 524288,
          defaultPullLimit: 200,
          maxPullLimit: 500,
          maxPullBytes: 524288,
          oneScopePerPush: true,
        },
      }),
    });

    await expect(runClient(client.bootstrap("user-1"))).resolves.toMatchObject({
      scopes: [
        expect.objectContaining({ scopeType: "user", scopeId: "user-1" }),
        expect.objectContaining({
          scopeType: "org",
          scopeId: "org-1",
          canWrite: false,
        }),
      ],
    });
  });

  it("validates request shape without imposing advertised operation limits", () => {
    expect(
      SettingsSyncPullCollectionRequestSchema.safeParse({
        collection: "vocabulary",
        cursor: 0,
        limit: 501,
      }).success,
    ).toBe(true);

    for (const limit of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        SettingsSyncPullCollectionRequestSchema.safeParse({
          collection: "vocabulary",
          cursor: 0,
          limit,
        }).success,
      ).toBe(false);
    }

    const mutation = {
      collection: "vocabulary" as const,
      scopeType: "user" as const,
      scopeId: "user-1",
      syncId: SYNC_ID,
      expectedSyncVersion: null,
      payload: { word: "Amical", replacement: null },
    };
    expect(
      SettingsSyncPushRequestSchema.safeParse({
        mutations: Array.from({ length: 101 }, () => mutation),
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed pull before returning any items", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        collections: [
          {
            collection: "vocabulary",
            items: [
              {
                collection: "vocabulary",
                syncId: SYNC_ID,
                syncVersion: 2,
                payload: { word: "later", replacement: null },
              },
              {
                collection: "vocabulary",
                syncId: "22222222-2222-4222-8222-222222222222",
                syncVersion: 1,
                payload: { word: "out-of-order", replacement: null },
              },
            ],
            cursor: 2,
            hasMore: false,
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.pull(
          "user",
          "user-1",
          [{ collection: "vocabulary", cursor: 0 }],
          200,
        ),
      ),
    ).rejects.toThrow("strictly cursor ordered");
  });

  it("sends and validates independent cursors for both collections", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        collections: [
          {
            collection: "vocabulary",
            items: [
              {
                collection: "vocabulary",
                syncId: SYNC_ID,
                syncVersion: 8,
                payload: { word: "Amical", replacement: null },
                etag: "vocabulary-8",
              },
            ],
            cursor: 8,
            hasMore: false,
            pageBytes: 128,
          },
          {
            collection: "snippet",
            items: [],
            cursor: 3,
            hasMore: false,
          },
        ],
        serverTime: "2026-07-25T00:00:00.000Z",
      }),
    });

    await expect(
      runClient(
        client.pull(
          "user",
          "user-1",
          [
            { collection: "vocabulary", cursor: 7 },
            { collection: "snippet", cursor: 3 },
          ],
          200,
        ),
      ),
    ).resolves.toEqual({
      collections: [
        {
          collection: "vocabulary",
          items: [
            {
              collection: "vocabulary",
              syncId: SYNC_ID,
              syncVersion: 8,
              payload: { word: "Amical", replacement: null },
            },
          ],
          cursor: 8,
          hasMore: false,
        },
        {
          collection: "snippet",
          items: [],
          cursor: 3,
          hasMore: false,
        },
      ],
    });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(JSON.parse(url.searchParams.get("collections")!)).toEqual([
      { collection: "vocabulary", cursor: 7, limit: 200 },
      { collection: "snippet", cursor: 3, limit: 200 },
    ]);
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("rejects unrequested pull collection blocks", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        collections: [
          {
            collection: "notes",
            items: [],
            cursor: 0,
            hasMore: false,
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.pull(
          "user",
          "user-1",
          [{ collection: "vocabulary", cursor: 0 }],
          200,
        ),
      ),
    ).rejects.toThrow("unrequested collection");
  });

  it("rejects an empty pull that advances the cursor", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        collections: [
          {
            collection: "vocabulary",
            items: [],
            cursor: 2,
            hasMore: false,
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.pull(
          "user",
          "user-1",
          [{ collection: "vocabulary", cursor: 1 }],
          200,
        ),
      ),
    ).rejects.toThrow("Empty pull");
  });

  it("applies Axis's null default for an omitted vocabulary replacement", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        collections: [
          {
            collection: "vocabulary",
            items: [
              {
                collection: "vocabulary",
                syncId: SYNC_ID,
                syncVersion: 1,
                payload: { word: "Amical" },
              },
            ],
            cursor: 1,
            hasMore: false,
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.pull(
          "user",
          "user-1",
          [{ collection: "vocabulary", cursor: 0 }],
          200,
        ),
      ),
    ).resolves.toEqual({
      collections: [
        {
          collection: "vocabulary",
          items: [
            {
              collection: "vocabulary",
              syncId: SYNC_ID,
              syncVersion: 1,
              payload: { word: "Amical", replacement: null },
            },
          ],
          cursor: 1,
          hasMore: false,
        },
      ],
    });
  });

  it("rejects a partial push response as a possible lost acknowledgement", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await expect(
      runClient(
        client.push([
          {
            collection: "vocabulary",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { word: "Amical", replacement: null },
          },
        ]),
      ),
    ).rejects.toThrow("result count");
  });

  it("rejects positional identity mismatches before application", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            status: "ok",
            syncId: "22222222-2222-4222-8222-222222222222",
            syncVersion: 1,
            applied: true,
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.push([
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { trigger: "sig", content: "hello" },
          },
        ]),
      ),
    ).rejects.toThrow("identity");
  });

  it("rejects a conflict canonical from another collection", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            status: "conflict",
            reason: "version_conflict",
            syncId: SYNC_ID,
            canonical: {
              collection: "vocabulary",
              syncId: SYNC_ID,
              syncVersion: 1,
              payload: { word: "wrong collection", replacement: null },
            },
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.push([
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { trigger: "sig", content: "hello" },
          },
        ]),
      ),
    ).rejects.toThrow("canonical identity");
  });

  it("rejects a duplicate-conflict winner for another key", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            status: "conflict",
            reason: "duplicate_key_conflict",
            syncId: SYNC_ID,
            canonical: null,
            conflictingItem: {
              collection: "snippet",
              syncId: "22222222-2222-4222-8222-222222222222",
              syncVersion: 1,
              payload: { trigger: "another-key", content: "server" },
            },
          },
        ],
      }),
    });

    await expect(
      runClient(
        client.push([
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { trigger: "sig", content: "local" },
          },
        ]),
      ),
    ).rejects.toThrow("does not match request key");
  });

  it("rejects a non-advancing version conflict", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            status: "conflict",
            reason: "version_conflict",
            syncId: SYNC_ID,
            canonical: {
              collection: "snippet",
              syncId: SYNC_ID,
              syncVersion: 2,
              payload: { trigger: "sig", content: "server" },
              etag: "snippet-2",
            },
            serverTraceId: "trace-1",
          },
        ],
        protocolVersion: 1,
      }),
    });

    await expect(
      runClient(
        client.push([
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: 2,
            payload: { trigger: "sig", content: "local" },
          },
        ]),
      ),
    ).rejects.toThrow("non-conflicting version");
  });

  it("surfaces HTTP status without changing durable state itself", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(runClient(client.bootstrap("user-1"))).rejects.toEqual(
      expect.objectContaining<Partial<SettingsSyncHttpError>>({
        status: 503,
      }),
    );
  });

  it("aborts an in-flight request when its client effect is interrupted", async () => {
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = init.signal as AbortSignal;
          requestSignal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const fiber = Effect.runFork(client.bootstrap("user-1"));
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps the request signal cancellable while decoding the response", async () => {
    let requestSignal: AbortSignal | undefined;
    let decodingStarted = false;
    fetchMock.mockImplementation((_url: URL, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        json: () => {
          decodingStarted = true;
          return new Promise((_resolve, reject) => {
            requestSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
      });
    });

    const fiber = Effect.runFork(client.bootstrap("user-1"));
    await vi.waitFor(() => expect(decodingStarted).toBe(true));
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(requestSignal?.aborted).toBe(true);
  });
});
