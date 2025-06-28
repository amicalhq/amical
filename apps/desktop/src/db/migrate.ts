import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./config";
import { logger } from "../main/logger";

export async function runMigrations() {
  try {
    // Run migrations
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    logger.db.info("Migrations completed successfully");
  } catch (error) {
    logger.db.error("Error running migrations:", error);
    throw error;
  }
}
