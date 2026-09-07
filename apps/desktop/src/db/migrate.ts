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
  db.$client.function("amical_vocabulary_id", () =>
    createEntityId("vocabulary"),
  );
  db.$client.function("amical_snippet_id", () => createEntityId("snippet"));
  db.$client.function("amical_is_uuid", (id) =>
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? 1
      : 0,
  );
  migrate(db, config);
}
