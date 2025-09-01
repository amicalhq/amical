CREATE TABLE `note_metadata` (
	`note_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`doc_name` text NOT NULL,
	`transcription_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_accessed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`transcription_id`) REFERENCES `transcriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_doc_name_unique` ON `notes` (`doc_name`);--> statement-breakpoint
CREATE TABLE `yjs_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_name` text NOT NULL,
	`update_data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
