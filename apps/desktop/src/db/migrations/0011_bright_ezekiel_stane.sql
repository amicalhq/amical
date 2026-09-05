ALTER TABLE `notes` ADD `content_format` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `legacy_content` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `migration_error` text;