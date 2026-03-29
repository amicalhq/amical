ALTER TABLE `transcriptions` ADD `detected_language` text;
--> statement-breakpoint
CREATE TABLE `daily_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`transcription_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_stats_date_unique_idx` ON `daily_stats` (`date`);
