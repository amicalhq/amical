import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@db/schema";
import path from "node:path";
import fs from "fs-extra";
import { TEST_USER_DATA_PATH } from "./electron-mocks";

let dbCounter = 0;

export interface TestDatabase {
  db: ReturnType<typeof drizzle>;
  dbPath: string;
  close: () => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Creates an isolated test database with migrations applied
 */
export async function createTestDatabase(
  options: {
    name?: string;
    skipMigrations?: boolean;
  } = {},
): Promise<TestDatabase> {
  const { name, skipMigrations = false } = options;

  // Create unique database path
  const dbName = name || `test-${dbCounter++}-${Date.now()}.db`;
  const dbPath = path.join(TEST_USER_DATA_PATH, "databases", dbName);

  // Ensure directory exists
  await fs.ensureDir(path.dirname(dbPath));

  // Create drizzle instance
  const client = new Database(dbPath);
  const db = drizzle(client, {
    schema: {
      ...schema,
    },
  });

  // Run migrations if not skipped
  if (!skipMigrations) {
    const migrationsPath = path.join(process.cwd(), "src", "db", "migrations");

    // Check if migrations exist
    if (!fs.existsSync(migrationsPath)) {
      console.warn(
        "Migrations folder not found at:",
        migrationsPath,
        "- skipping migrations",
      );
    } else {
      try {
        migrate(db, {
          migrationsFolder: migrationsPath,
        });
      } catch (error) {
        console.error("Failed to run migrations:", error);
        throw error;
      }
    }
  }

  return {
    db,
    dbPath,
    close: async () => {
      db.$client.close();
    },
    clear: async () => {
      // Clear all tables
      db.delete(schema.syncOutbox).run();
      db.delete(schema.syncItemState).run();
      db.delete(schema.syncCollectionState).run();
      db.delete(schema.syncScopeState).run();
      db.delete(schema.syncClientState).run();
      db.delete(schema.transcriptions).run();
      db.delete(schema.dailyStats).run();
      db.delete(schema.vocabulary).run();
      db.delete(schema.snippets).run();
      db.delete(schema.models).run();
      db.delete(schema.appSettings).run();
      db.delete(schema.yjsUpdates).run();
      db.delete(schema.notes).run();
    },
  };
}

/**
 * Deletes a test database file
 */
export async function deleteTestDatabase(dbPath: string): Promise<void> {
  try {
    await fs.remove(dbPath);
  } catch (error) {
    console.error("Failed to delete test database:", error);
  }
}

/**
 * Clears all test databases
 */
export async function clearAllTestDatabases(): Promise<void> {
  const dbDir = path.join(TEST_USER_DATA_PATH, "databases");
  try {
    await fs.emptyDir(dbDir);
  } catch (error) {
    console.error("Failed to clear test databases:", error);
  }
}

/**
 * Helper to get database instance for testing
 * This bypasses the singleton pattern used in production
 */
export function createMockDb(dbPath: string) {
  const client = new Database(dbPath);
  return drizzle(client, {
    schema: {
      ...schema,
    },
  });
}
