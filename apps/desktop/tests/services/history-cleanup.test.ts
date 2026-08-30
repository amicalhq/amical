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

import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  HistoryCleanupService,
  SETTINGS_CHANGE_CLEANUP_DELAY_MS,
} from "../../src/services/history-cleanup-service";
import {
  HistoryCleanupServiceTag,
  SettingsServiceTag,
  AppScopeTag,
} from "../../src/main/runtime/tags";

describe("HistoryCleanupService", () => {
  let testDb: TestDatabase;
  let cleanupService: HistoryCleanupService | null = null;
  let closeScope: (() => Promise<void>) | null = null;

  // The service is only constructible through its Live layer; build it with
  // fakes via Layer.succeed (see tests/README.md). Closing the scope runs the
  // registered release — the same path the app's cleanup() takes.
  async function buildCleanupService(
    settingsService: unknown,
  ): Promise<HistoryCleanupService> {
    const scope = Effect.runSync(Scope.make());
    const ctx = await Effect.runPromise(
      Layer.build(
        HistoryCleanupService.Live.pipe(
          Layer.provide(
            Layer.succeed(SettingsServiceTag, settingsService as never),
          ),
          Layer.provide(Layer.succeed(AppScopeTag, scope)),
        ),
      ).pipe(Scope.extend(scope)),
    );
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));
    return Context.get(ctx, HistoryCleanupServiceTag);
  }

  beforeEach(async () => {
    testDb = await createTestDatabase();
    activeDb = testDb.db;
  });

  afterEach(async () => {
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
    cleanupService = null;

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
        disposition: "success",
        text: "expired transcription",
        timestamp: twoDaysAgo,
        createdAt: twoDaysAgo,
      },
      {
        disposition: "success",
        text: "recent transcription",
        timestamp: now,
        createdAt: now,
      },
    ]);

    cleanupService = await buildCleanupService(settingsService);
    await cleanupService.runCleanup("startup");

    const remaining = await testDb.db.select().from(schema.transcriptions);
    const queuedActivities = await testDb.db
      .select()
      .from(schema.activityOutbox);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.text).toBe("recent transcription");
    expect(queuedActivities).toHaveLength(2);
    expect(
      queuedActivities.some(
        (row) =>
          row.payload.occurredAt ===
          new Date(
            Math.floor(twoDaysAgo.getTime() / 1000) * 1000,
          ).toISOString(),
      ),
    ).toBe(true);
  });

  it("skips unsettled rows while preserving later activity before cleanup", async () => {
    const settingsService = {
      getHistorySettings: vi.fn().mockResolvedValue({ retentionPeriod: "1d" }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    await testDb.db.insert(schema.transcriptions).values([
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        disposition: null,
        text: "",
        timestamp: twoDaysAgo,
      },
      {
        disposition: "success",
        text: "must remain recoverable",
        timestamp: twoDaysAgo,
      },
    ]);

    cleanupService = await buildCleanupService(settingsService);
    await cleanupService.runCleanup("startup");

    const remaining = await testDb.db.select().from(schema.transcriptions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.disposition).toBeNull();
    expect(await testDb.db.select().from(schema.activityOutbox)).toHaveLength(
      1,
    );
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
        disposition: "success",
        text: "older transcription",
        timestamp: twoDaysAgo,
      },
      {
        disposition: "success",
        text: "recent transcription",
        timestamp: now,
      },
    ]);

    cleanupService = await buildCleanupService(settingsService);
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
      disposition: "success",
      text: "expired transcription",
      timestamp: twoDaysAgo,
    });

    cleanupService = await buildCleanupService(settingsService);
    await cleanupService.runCleanup("startup");

    retentionPeriod = "1d";
    (historySettingsChangedHandler as (() => void) | null)?.();

    await vi.advanceTimersByTimeAsync(
      SETTINGS_CHANGE_CLEANUP_DELAY_MS - 60 * 1000,
    );

    (historySettingsChangedHandler as (() => void) | null)?.();

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
