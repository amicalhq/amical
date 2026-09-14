import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/db/migrate";
import { CURRENT_SETTINGS_VERSION } from "../../src/db/settings-migrations";
import { runDataMigrations } from "../../src/main/migrations/data-migrations";
import {
  appSettings,
  dailyStatsBackup,
  dictationStats,
  transcriptions,
} from "../../src/db/schema";
import { defaultAppSettings } from "../helpers/fixtures";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

const migrationsFolder = join(process.cwd(), "src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
);

describe("dictation stats cache migration", () => {
  let testDb: TestDatabase;
  let legacyFolder: string;

  beforeEach(async () => {
    testDb = await createTestDatabase({ skipMigrations: true });
    setTestDatabase(testDb.db);
    legacyFolder = mkdtempSync(join(tmpdir(), "amical-stats-migration-"));
    mkdirSync(join(legacyFolder, "meta"));
    const entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx <= 15,
    );
    writeFileSync(
      join(legacyFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      writeFileSync(
        join(legacyFolder, `${entry.tag}.sql`),
        readFileSync(join(migrationsFolder, `${entry.tag}.sql`)),
      );
    }
    migrateDatabase(testDb.db, { migrationsFolder: legacyFolder });
  });

  afterEach(async () => {
    await testDb.close();
    rmSync(legacyFolder, { recursive: true, force: true });
  });

  function setLegacyVersion(version: number) {
    testDb.db
      .insert(appSettings)
      .values({
        id: 1,
        version: CURRENT_SETTINGS_VERSION,
        data: {
          ...defaultAppSettings,
          dataMigrations: { dictationDailyStats: version },
        },
      })
      .run();
  }

  it("preserves all legacy rows and deleted-history counts across upgrades and startup", async () => {
    const client = testDb.db.$client;
    client.exec(`INSERT INTO daily_stats (id, date, word_count, transcription_count, created_at, updated_at) VALUES
      ('old', '2025-02-10', 9000, 200, 1234, 5678),
      ('new', '2026-09-10', 1000, 30, 9999, 10000)`);
    const backup = client
      .prepare("SELECT * FROM daily_stats ORDER BY id")
      .all();
    testDb.db
      .insert(transcriptions)
      .values({ text: "remaining history", disposition: "success" })
      .run();
    setLegacyVersion(0);

    migrateDatabase(testDb.db, { migrationsFolder });
    expect(testDb.db.select().from(dictationStats).get()).toMatchObject({
      scope: "device",
      totalWords: 10000,
      totalTranscriptions: 230,
      revision: 0,
    });
    expect(
      client.prepare("SELECT * FROM daily_stats_backup ORDER BY id").all(),
    ).toEqual(backup);
    expect(
      client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_stats'",
        )
        .get(),
    ).toBeUndefined();
    await runDataMigrations();
    migrateDatabase(testDb.db, { migrationsFolder });
    await runDataMigrations();
    expect(
      client.prepare("SELECT * FROM daily_stats_backup ORDER BY id").all(),
    ).toEqual(backup);
    expect(testDb.db.select().from(dictationStats).get()?.totalWords).toBe(
      10000,
    );
  });

  it.each([1, 2])(
    "preserves an authoritative empty legacy cache at version %s",
    (version) => {
      setLegacyVersion(version);
      testDb.db
        .insert(transcriptions)
        .values({ text: "must not be counted", disposition: "success" })
        .run();
      migrateDatabase(testDb.db, { migrationsFolder });
      expect(testDb.db.select().from(dictationStats).get()).toMatchObject({
        totalWords: 0,
        totalTranscriptions: 0,
      });
    },
  );

  it("preserves zero-valued legacy rows even without a completed data migration", () => {
    testDb.db.$client.exec(
      "INSERT INTO daily_stats VALUES ('zero', '2026-09-14', 0, 0, 1234, 5678)",
    );
    testDb.db
      .insert(transcriptions)
      .values({ text: "must not be counted", disposition: "success" })
      .run();
    migrateDatabase(testDb.db, { migrationsFolder });
    expect(testDb.db.select().from(dictationStats).get()).toMatchObject({
      totalWords: 0,
      totalTranscriptions: 0,
    });
    expect(testDb.db.select().from(dailyStatsBackup).all()).toHaveLength(1);
  });

  it("seeds retained settled history only when daily stats have never run", () => {
    setLegacyVersion(0);
    testDb.db
      .insert(transcriptions)
      .values([
        { text: "one two three", disposition: "success" },
        { text: "", disposition: "failure" },
        {
          text: "still recording",
          sessionId: "provisional",
          disposition: null,
        },
      ])
      .run();
    migrateDatabase(testDb.db, { migrationsFolder });
    expect(testDb.db.select().from(dictationStats).get()).toMatchObject({
      totalWords: 3,
      totalTranscriptions: 2,
    });
    expect(testDb.db.select().from(dailyStatsBackup).all()).toEqual([]);
    testDb.db.delete(transcriptions).run();
    migrateDatabase(testDb.db, { migrationsFolder });
    expect(testDb.db.select().from(dictationStats).get()?.totalWords).toBe(3);
  });

  it("seeds a fresh database with zero device totals and no account rows", () => {
    migrateDatabase(testDb.db, { migrationsFolder });
    expect(testDb.db.select().from(dictationStats).all()).toEqual([
      {
        scope: "device",
        totalWords: 0,
        totalTranscriptions: 0,
        revision: 0,
      },
    ]);
    expect(testDb.db.select().from(dailyStatsBackup).all()).toEqual([]);
  });

  it("rolls back the backup rename, new table, and seed together on failure", () => {
    const entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx <= 16,
    );
    writeFileSync(
      join(legacyFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    writeFileSync(
      join(legacyFolder, "0016_dictation_stats_cache.sql"),
      readFileSync(
        join(migrationsFolder, "0016_dictation_stats_cache.sql"),
        "utf8",
      ) + "\n--> statement-breakpoint\nSELECT * FROM missing_table;",
    );
    testDb.db.$client.exec(
      "INSERT INTO daily_stats VALUES ('old', '2026-09-14', 500, 20, 1234, 5678)",
    );
    const before = testDb.db.$client.prepare("SELECT * FROM daily_stats").all();
    expect(() =>
      migrateDatabase(testDb.db, { migrationsFolder: legacyFolder }),
    ).toThrow();
    expect(
      testDb.db.$client.prepare("SELECT * FROM daily_stats").all(),
    ).toEqual(before);
    expect(
      testDb.db.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('daily_stats_backup', 'dictation_stats')",
        )
        .all(),
    ).toEqual([]);
    migrateDatabase(testDb.db, { migrationsFolder });
    expect(testDb.db.select().from(dictationStats).get()?.totalWords).toBe(500);
  });
});
