import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as schema from './schema';

// Get the user data directory for storing the database
const dbPath = path.join(app.getPath('userData'), 'amical.db');

export const db = drizzle(`file:${dbPath}`, {
  schema: {
    ...schema,
  },
});

// Initialize database with migrations
let isInitialized = false;

export async function initializeDatabase() {
  if (isInitialized) {
    return;
  }

  try {
    // Determine the correct migrations folder path
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    let migrationsPath: string;
    
    if (isDev) {
      // Development: use source path relative to the app's working directory
      migrationsPath = path.join(process.cwd(), 'src', 'db', 'migrations');
    } else {
      // Production: migrations should be in app resources
      migrationsPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main', 'db', 'migrations');
    }
    
    console.log('Attempting to run migrations from:', migrationsPath);
    console.log('__dirname:', __dirname);
    console.log('process.cwd():', process.cwd());
    console.log('isDev:', isDev);
    
    // Check if the migrations path exists
    if (!fs.existsSync(migrationsPath)) {
      throw new Error(`Migrations folder not found at: ${migrationsPath}`);
    }
    
    const journalPath = path.join(migrationsPath, 'meta', '_journal.json');
    if (!fs.existsSync(journalPath)) {
      throw new Error(`Journal file not found at: ${journalPath}`);
    }
    
    // Run migrations to ensure database is up to date
    await migrate(db, { 
      migrationsFolder: migrationsPath
    });
    
    console.log('Database initialized and migrations completed successfully');
    isInitialized = true;
  } catch (error) {
    console.error('FATAL: Error initializing database:', error);
    console.error('Application cannot continue without a working database. Exiting...');
    
    // Fatal exit - app cannot function without database
    process.exit(1);
  }
}
