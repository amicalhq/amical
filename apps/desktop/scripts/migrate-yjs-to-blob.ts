#!/usr/bin/env tsx
/**
 * Migration script to convert base64 encoded yjs_updates to blob format
 * Run this after applying the schema migration but before running the app
 */

import { db } from "../src/db";
import { yjsUpdates } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function migrateYjsUpdatesToBlob() {
  console.log("Starting migration of yjs_updates from base64 to blob...");

  try {
    // Get all updates
    const updates = await db.select().from(yjsUpdates);
    console.log(`Found ${updates.length} updates to migrate`);

    let migrated = 0;
    let skipped = 0;

    for (const update of updates) {
      try {
        // Check if data is already a Buffer or still base64 string
        if (typeof update.updateData === "string") {
          // Convert base64 string to Buffer
          const buffer = Buffer.from(update.updateData, "base64");

          // Update the record with the Buffer
          await db
            .update(yjsUpdates)
            .set({ updateData: buffer })
            .where(eq(yjsUpdates.id, update.id));

          migrated++;
        } else {
          // Already migrated
          skipped++;
        }
      } catch (error) {
        console.error(`Failed to migrate update ${update.id}:`, error);
      }
    }

    console.log(`Migration complete!`);
    console.log(`- Migrated: ${migrated} updates`);
    console.log(`- Skipped (already migrated): ${skipped} updates`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
migrateYjsUpdatesToBlob()
  .then(() => {
    console.log("Migration successful!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration error:", error);
    process.exit(1);
  });
