import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import { createEntityId } from "@amical/types";

// ID migrations use the same CUID2 generators as new records. Keep generation
// inside Drizzle's migration transaction so failed upgrades roll back together.
export function migrateDatabase<TSchema extends Record<string, unknown>>(
  db: BetterSQLite3Database<TSchema> & { $client: Database.Database },
  config: Parameters<typeof migrate>[1],
) {
  db.$client.function("amical_note_id", () => createEntityId("note"));
  migrate(db, config);
}
