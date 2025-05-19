/* import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import * as schema from './schema';

// Get the user data directory for storing the database
const dbPath = path.join(app.getPath('userData'), 'amical.db');

// Create SQLite database instance
const sqlite = new Database(dbPath);

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export the SQLite instance in case we need it for migrations
export const sqliteDb = sqlite;
 */