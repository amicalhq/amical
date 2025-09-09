CREATE TABLE `models` (
	`id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` text,
	`context` text,
	`description` text,
	`local_path` text,
	`size_bytes` integer,
	`checksum` text,
	`downloaded_at` integer,
	`original_model` text,
	`speed` real,
	`accuracy` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`provider`, `id`)
);
--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider`);--> statement-breakpoint
CREATE INDEX `models_type_idx` ON `models` (`type`);--> statement-breakpoint
DROP TABLE `downloaded_models`;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `replacement_word` text;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `is_replacement` integer DEFAULT false;