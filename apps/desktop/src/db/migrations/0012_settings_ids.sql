-- Reset settings sync before changing IDs. Normal enrollment rebuilds it.
DELETE FROM `sync_outbox` WHERE `collection` IN ('vocabulary', 'snippet');
--> statement-breakpoint
DELETE FROM `sync_item_state` WHERE `collection` IN ('vocabulary', 'snippet');
--> statement-breakpoint
DELETE FROM `sync_collection_state` WHERE `collection` IN ('vocabulary', 'snippet');
--> statement-breakpoint
UPDATE `vocabulary` SET `id` = amical_vocabulary_id() WHERE amical_is_uuid(`id`);
--> statement-breakpoint
UPDATE `snippets` SET `id` = amical_snippet_id() WHERE amical_is_uuid(`id`);
