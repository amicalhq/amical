import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthService } from "../../src/services/auth-service";
import {
  SettingsSyncClient,
  SettingsSyncHttpError,
} from "../../src/services/settings-sync-client";

const SYNC_ID = "11111111-1111-4111-8111-111111111111";

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
          },
        ],
        capabilities: {
          collections: ["vocabulary", "snippet", "notes"],
          maxPushBatch: 100,
          maxPushBytes: 524288,
          defaultPullLimit: 200,
          maxPullLimit: 500,
          maxPullBytes: 524288,
          oneScopePerPush: true,
        },
      }),
    });

    await expect(
      client.bootstrap("user-1", new AbortController().signal),
    ).resolves.toEqual({
      collections: ["vocabulary", "snippet"],
      maxPushBatch: 100,
      maxPushBytes: 524288,
      pullLimit: 200,
    });

    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(url.toString()).toBe("https://core.test/apps/v1/sync/bootstrap");
    expect(init.headers.Authorization).toBe("Bearer id-token");
  });

  it("rejects a malformed pull before returning any items", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        items: [
          {
            collection: "snippet",
            syncId: SYNC_ID,
            syncVersion: 2,
            payload: { trigger: "sig", content: "valid" },
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
      }),
    });

    await expect(
      client.pull("user", "user-1", 0, 200, new AbortController().signal),
    ).rejects.toThrow("strictly cursor ordered");
  });

  it("ignores unsupported pull collections while advancing the scope cursor", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        items: [
          {
            collection: "notes",
            syncId: SYNC_ID,
            syncVersion: 1,
            payload: { content: "unsupported" },
          },
        ],
        cursor: 1,
        hasMore: false,
      }),
    });

    await expect(
      client.pull("user", "user-1", 0, 200, new AbortController().signal, [
        "vocabulary",
        "snippet",
      ]),
    ).resolves.toEqual({ items: [], cursor: 1, hasMore: false });
  });

  it("rejects an empty pull that advances the cursor", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeType: "user",
        scopeId: "user-1",
        items: [],
        cursor: 2,
        hasMore: false,
      }),
    });

    await expect(
      client.pull("user", "user-1", 1, 200, new AbortController().signal),
    ).rejects.toThrow("Empty pull");
  });

  it("rejects a partial push response as a possible lost acknowledgement", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await expect(
      client.push(
        [
          {
            collection: "vocabulary",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { word: "Amical", replacement: null },
          },
        ],
        new AbortController().signal,
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
      client.push(
        [
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { trigger: "sig", content: "hello" },
          },
        ],
        new AbortController().signal,
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
      client.push(
        [
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { trigger: "sig", content: "hello" },
          },
        ],
        new AbortController().signal,
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
      client.push(
        [
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: null,
            payload: { trigger: "sig", content: "local" },
          },
        ],
        new AbortController().signal,
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
            },
          },
        ],
      }),
    });

    await expect(
      client.push(
        [
          {
            collection: "snippet",
            scopeType: "user",
            scopeId: "user-1",
            syncId: SYNC_ID,
            expectedSyncVersion: 2,
            payload: { trigger: "sig", content: "local" },
          },
        ],
        new AbortController().signal,
      ),
    ).rejects.toThrow("non-conflicting version");
  });

  it("surfaces HTTP status without changing durable state itself", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      client.bootstrap("user-1", new AbortController().signal),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SettingsSyncHttpError>>({
        status: 503,
      }),
    );
  });
});
