PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_models` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`size` text,
	`context` text NOT NULL,
	`description` text,
	`original_model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`provider`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_provider_models`("id", "name", "provider", "size", "context", "description", "original_model", "created_at", "updated_at") SELECT "id", "name", "provider", "size", "context", "description", "original_model", "created_at", "updated_at" FROM `provider_models`;--> statement-breakpoint
DROP TABLE `provider_models`;--> statement-breakpoint
ALTER TABLE `__new_provider_models` RENAME TO `provider_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `provider_models_provider_idx` ON `provider_models` (`provider`);