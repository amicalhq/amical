import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as schema from "./schema";

// Get the user data directory for storing the database
export const dbPath = app.isPackaged
  ? path.join(app.getPath("userData"), "vox.db")
  : path.join(process.cwd(), "vox.db");

export const db = drizzle(`file:${dbPath}`, {
  schema: {
    ...schema,
  },
});

// Initialize database with migrations
let isInitialized = false;
let dbConnection: null | typeof db = null;

import { logger } from "../main/logger";

export async function initializeDatabase() {
  if (isInitialized) {
    return;
  }

  try {
    // Store the connection for later cleanup
    dbConnection = db;

    // Determine the correct migrations folder path
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    let migrationsPath: string;

    if (isDev) {
      // Development: use source path relative to the app's working directory
      migrationsPath = path.join(process.cwd(), "src", "db", "migrations");
    } else {
      // Production: migrations are copied to resources via extraResource
      migrationsPath = path.join(process.resourcesPath, "migrations");
    }

    logger.db.debug("Attempting to run migrations from:", migrationsPath);
    logger.db.debug("__dirname:", __dirname);
    logger.db.debug("process.cwd():", process.cwd());
    logger.db.debug("isDev:", isDev);

    // Check if the migrations path exists
    if (!fs.existsSync(migrationsPath)) {
      throw new Error(`Migrations folder not found at: ${migrationsPath}`);
    }

    const journalPath = path.join(migrationsPath, "meta", "_journal.json");
    if (!fs.existsSync(journalPath)) {
      throw new Error(`Journal file not found at: ${journalPath}`);
    }

    // Run migrations to ensure database is up to date
    await migrate(db, {
      migrationsFolder: migrationsPath,
    });

    logger.db.info(
      "Database initialized and migrations completed successfully",
    );
    isInitialized = true;
  } catch (error) {
    logger.db.error("FATAL: Error initializing database:", error);
    logger.db.error(
      "Application cannot continue without a working database. Exiting...",
    );

    // Fatal exit - app cannot function without database
    process.exit(1);
  }
}

export async function closeDatabase() {
  if (dbConnection) {
    db.$client.close();
    dbConnection = null;
    isInitialized = false;
    dbConnection = null;
    isInitialized = false;
    logger.db.info("Database connection closed successfully");
  }
}
