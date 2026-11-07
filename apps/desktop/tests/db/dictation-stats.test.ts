import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db";
import {
  applyAccountSummary,
  getLifetimeStats,
  getStatsRevision,
  incrementDictationStats,
} from "../../src/db/dictation-stats";
import { dictationStatsEvents } from "../../src/db/dictation-stats-events";
import { appSettings, transcriptions } from "../../src/db/schema";
import { defaultAppSettings } from "../helpers/fixtures";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

describe("persisted dictation stats", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    dictationStatsEvents.removeAllListeners();
    await testDb.close();
  });

  function authenticate(
    accountId: string | null,
    authenticated = accountId !== null,
  ) {
    const data = {
      ...defaultAppSettings,
      auth: {
        isAuthenticated: authenticated,
        idToken: null,
        refreshToken: null,
        accessToken: null,
        expiresAt: null,
        ...(accountId === null ? {} : { userInfo: { sub: accountId } }),
      },
    };
    testDb.db
      .insert(appSettings)
      .values({ id: 1, data })
      .onConflictDoUpdate({ target: appSettings.id, set: { data } })
      .run();
  }

  function increment(words: number, count = 1) {
    db.transaction((tx) => incrementDictationStats(words, count, tx));
  }

  it("persists device totals while signed out, independent of retained history", () => {
    expect(getLifetimeStats()).toEqual({
      totalWords: 0,
      totalTranscriptions: 0,
    });
    increment(25);
    testDb.db
      .insert(transcriptions)
      .values({ text: "kept briefly", disposition: "success" })
      .run();
    testDb.db.delete(transcriptions).run();
    expect(getLifetimeStats()).toEqual({
      totalWords: 25,
      totalTranscriptions: 1,
    });
    expect(getStatsRevision()).toBe(1);
  });

  it("increments device and only the authenticated account in one transaction", () => {
    increment(10);
    authenticate("alice");
    expect(getLifetimeStats()).toBeNull();
    increment(7);
    expect(getLifetimeStats()).toEqual({
      totalWords: 7,
      totalTranscriptions: 1,
    });
    authenticate("bob");
    expect(getLifetimeStats()).toBeNull();
    increment(3);
    expect(getLifetimeStats()).toEqual({
      totalWords: 3,
      totalTranscriptions: 1,
    });
    authenticate(null);
    expect(getLifetimeStats()).toEqual({
      totalWords: 20,
      totalTranscriptions: 3,
    });
    authenticate("alice");
    expect(getLifetimeStats()).toEqual({
      totalWords: 7,
      totalTranscriptions: 1,
    });
  });

  it("does not expose device totals for authenticated settings without an account ID", () => {
    increment(10);
    authenticate(null, true);
    expect(getLifetimeStats()).toBeNull();
  });

  it("rolls back both scopes and revision with the caller transaction", async () => {
    authenticate("alice");
    const changed = vi.fn();
    dictationStatsEvents.on("changed", changed);
    expect(() =>
      db.transaction((tx) => {
        incrementDictationStats(25, 1, tx);
        throw new Error("settlement failed");
      }),
    ).toThrow("settlement failed");
    expect(getStatsRevision()).toBe(0);
    expect(getLifetimeStats()).toBeNull();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
  });

  it("increments revisions only for meaningful writes, without emitting inside the helper", async () => {
    const changed = vi.fn();
    dictationStatsEvents.on("changed", changed);
    increment(0, 0);
    expect(getStatsRevision()).toBe(0);
    increment(0, 1);
    expect(getStatsRevision()).toBe(1);
    increment(4, 0);
    expect(getStatsRevision()).toBe(2);
    expect(getLifetimeStats()).toEqual({
      totalWords: 4,
      totalTranscriptions: 1,
    });
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
  });

  it("applies an account summary after commit and leaves device totals unchanged", async () => {
    increment(100);
    authenticate("alice");
    const changed = vi.fn(() =>
      expect(getLifetimeStats()).toEqual({
        totalWords: 12000,
        totalTranscriptions: 500,
      }),
    );
    dictationStatsEvents.on("changed", changed);
    expect(
      applyAccountSummary("alice", 1, { words: 12000, activities: 500 }),
    ).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    expect(getStatsRevision()).toBe(1);
    authenticate(null);
    expect(getLifetimeStats()).toEqual({
      totalWords: 100,
      totalTranscriptions: 1,
    });
  });

  it("rejects stale summaries without overwriting newer local counts or emitting", async () => {
    authenticate("alice");
    applyAccountSummary("alice", 0, { words: 100, activities: 10 });
    await Promise.resolve();
    const revision = getStatsRevision();
    increment(5);
    const changed = vi.fn();
    dictationStatsEvents.on("changed", changed);
    expect(
      applyAccountSummary("alice", revision, { words: 100, activities: 10 }),
    ).toBe(false);
    expect(getLifetimeStats()).toEqual({
      totalWords: 105,
      totalTranscriptions: 11,
    });
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
  });

  it("rejects summaries after account switch or logout and accepts genuine zero", () => {
    authenticate("alice");
    expect(applyAccountSummary("alice", 0, { words: 0, activities: 0 })).toBe(
      true,
    );
    expect(getLifetimeStats()).toEqual({
      totalWords: 0,
      totalTranscriptions: 0,
    });
    authenticate("bob");
    expect(
      applyAccountSummary("alice", 0, { words: 100, activities: 10 }),
    ).toBe(false);
    authenticate(null);
    expect(
      applyAccountSummary("alice", 0, { words: 100, activities: 10 }),
    ).toBe(false);
    authenticate("alice");
    expect(getLifetimeStats()).toEqual({
      totalWords: 0,
      totalTranscriptions: 0,
    });
  });
});
