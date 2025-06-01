import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import * as schema from './schema';

// Get the user data directory for storing the database
const dbPath = path.join(app.getPath('userData'), 'amical.db');

// Create SQLite database instance with proper configuration
const sqlite = new Database(dbPath, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
});

// Enable foreign keys
sqlite.pragma('foreign_keys = ON');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export the SQLite instance in case we need it for migrations
export const sqliteDb = sqlite;

// Initialize database function (run migrations, create tables, etc.)
export async function initializeDatabase() {
  try {
    // Enable WAL mode for better performance
    sqlite.pragma('journal_mode = WAL');
    
    console.log('Database initialized successfully at:', dbPath);
    return true;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    return false;
  }
}

// Close database connection
export function closeDatabaseConnection() {
  try {
    sqlite.close();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }
}