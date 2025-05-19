import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Example table - you can add more tables as needed
export const recordings = sqliteTable('recordings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
});
