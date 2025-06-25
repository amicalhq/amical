import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './config';

export async function runMigrations() {
  try {
    // Run migrations
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
}
