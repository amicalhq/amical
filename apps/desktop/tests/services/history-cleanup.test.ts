import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "@db/schema";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let activeDb: TestDatabase["db"] | null = null;

vi.mock("../../src/db/index.ts", () => ({
  get db() {
    if (!activeDb) {
      throw new Error("Test database not set");
    }
    return activeDb;
  },
  dbPath: "/test/db/path",
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

import {
  HistoryCleanupService,
  SETTINGS_CHANGE_CLEANUP_DELAY_MS,
} from "../../src/services/history-cleanup-service";

describe("HistoryCleanupService", () => {
  let testDb: TestDatabase;
  let cleanupService: HistoryCleanupService | null = null;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    activeDb = testDb.db;
  });

  afterEach(async () => {
    if (cleanupService) {
      await cleanupService.cleanup();
      cleanupService = null;
    }

    vi.useRealTimers();

    activeDb = null;

    if (testDb) {
      await testDb.close();
    }
  });

  it("deletes expired history on startup based on retention settings", async () => {
    const settingsService = {
      getHistorySettings: vi.fn().mockResolvedValue({ retentionPeriod: "1d" }),
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await testDb.db.insert(schema.transcriptions).values([
      {
        text: "expired transcription",
        timestamp: twoDaysAgo,
      },
      {
        text: "recent transcription",
        timestamp: now,
      },
    ]);

    cleanupService = new HistoryCleanupService(settingsService);
    await cleanupService.initialize();
    await cleanupService.runCleanup("startup");

    const remaining = await testDb.db.select().from(schema.transcriptions);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.text).toBe("recent transcription");
  });

  it("keeps history intact when retention is set to never", async () => {
    const settingsService = {
      getHistorySettings: vi
        .fn()
        .mockResolvedValue({ retentionPeriod: "never" }),
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await testDb.db.insert(schema.transcriptions).values([
      {
        text: "older transcription",
        timestamp: twoDaysAgo,
      },
      {
        text: "recent transcription",
        timestamp: now,
      },
    ]);

    cleanupService = new HistoryCleanupService(settingsService);
    await cleanupService.initialize();
    await cleanupService.runCleanup("startup");

    const remaining = await testDb.db.select().from(schema.transcriptions);

    expect(remaining).toHaveLength(2);
  });

  it("waits five minutes after the last settings change before cleaning up", async () => {
    vi.useFakeTimers();

    let retentionPeriod: "never" | "1d" = "never";
    let historySettingsChangedHandler: (() => void) | null = null;

    const settingsService = {
      getHistorySettings: vi.fn().mockImplementation(async () => ({
        retentionPeriod,
      })),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "history-settings-changed") {
          historySettingsChangedHandler = handler;
        }
      }),
      off: vi.fn(),
    } as any;

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await testDb.db.insert(schema.transcriptions).values({
      text: "expired transcription",
      timestamp: twoDaysAgo,
    });

    cleanupService = new HistoryCleanupService(settingsService);
    await cleanupService.initialize();
    await cleanupService.runCleanup("startup");

    retentionPeriod = "1d";
    historySettingsChangedHandler?.();

    await vi.advanceTimersByTimeAsync(
      SETTINGS_CHANGE_CLEANUP_DELAY_MS - 60 * 1000,
    );

    historySettingsChangedHandler?.();

    await vi.advanceTimersByTimeAsync(60 * 1000);

    let remaining = await testDb.db.select().from(schema.transcriptions);
    expect(remaining).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      SETTINGS_CHANGE_CLEANUP_DELAY_MS - 60 * 1000,
    );

    remaining = await testDb.db.select().from(schema.transcriptions);
    expect(remaining).toHaveLength(0);
  });
});
