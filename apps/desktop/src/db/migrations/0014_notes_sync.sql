ALTER TABLE `notes` ADD `account_id` text;
--> statement-breakpoint
ALTER TABLE `notes` ADD `local_only` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `notes` ADD `sync_error` text;
--> statement-breakpoint
ALTER TABLE `sync_outbox` ADD `blocked_reason` text;
--> statement-breakpoint
ALTER TABLE `sync_item_state` ADD `note_remote_version` integer;
--> statement-breakpoint
ALTER TABLE `sync_outbox` ADD `desired_not_before` integer DEFAULT 0 NOT NULL;
