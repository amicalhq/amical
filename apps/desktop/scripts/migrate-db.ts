import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrateDatabase } from "../src/db/migrate";

const db = drizzle("amical.db");
try {
  migrateDatabase(db, { migrationsFolder: "src/db/migrations" });
} finally {
  db.$client.close();
}
