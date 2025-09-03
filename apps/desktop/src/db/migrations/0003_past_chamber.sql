PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- First, check for and resolve any potential conflicts (same provider+id combination)
-- Delete duplicate rows, keeping the most recent one for each (provider, id) pair
DELETE FROM `provider_models` 
WHERE rowid NOT IN (
  SELECT MAX(rowid) 
  FROM `provider_models` 
  GROUP BY provider, id
);--> statement-breakpoint

-- Create new table with composite primary key
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
);--> statement-breakpoint

-- Copy all data to new table
INSERT INTO `__new_provider_models`("id", "name", "provider", "size", "context", "description", "original_model", "created_at", "updated_at") 
SELECT "id", "name", "provider", "size", "context", "description", "original_model", "created_at", "updated_at" 
FROM `provider_models`;--> statement-breakpoint

-- Drop old table and rename new one
DROP TABLE `provider_models`;--> statement-breakpoint
ALTER TABLE `__new_provider_models` RENAME TO `provider_models`;--> statement-breakpoint

PRAGMA foreign_keys=ON;--> statement-breakpoint

-- Create index on provider for efficient provider-scoped lookups
CREATE INDEX `provider_models_provider_idx` ON `provider_models` (`provider`);