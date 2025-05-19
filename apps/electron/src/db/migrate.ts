/* import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './config';

export function runMigrations() {
  try {
    // Run migrations
    migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
}
 */