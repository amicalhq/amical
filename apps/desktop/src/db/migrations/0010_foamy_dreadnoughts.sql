CREATE TABLE `activity_materialization_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` text,
	`transcription_cursor` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_materialization_state_singleton_check" CHECK("activity_materialization_state"."id" = 1),
	CONSTRAINT "activity_materialization_state_cursor_check" CHECK("activity_materialization_state"."transcription_cursor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `activity_outbox` (
	`activity_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_outbox_created_idx` ON `activity_outbox` (`created_at`);--> statement-breakpoint
ALTER TABLE `transcriptions` ADD `audio_duration_ms` integer;