import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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
  const db = drizzle(`file:${dbPath}`, {
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
        await migrate(db, {
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
      await db.delete(schema.transcriptions);
      await db.delete(schema.vocabulary);
      await db.delete(schema.models);
      await db.delete(schema.appSettings);
      await db.delete(schema.yjsUpdates);
      await db.delete(schema.notes);
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
  return drizzle(`file:${dbPath}`, {
    schema: {
      ...schema,
    },
  });
}
