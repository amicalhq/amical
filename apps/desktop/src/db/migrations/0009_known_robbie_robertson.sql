CREATE TABLE `sync_scope_state` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`role` text,
	`can_write` integer NOT NULL,
	PRIMARY KEY(`scope_type`, `scope_id`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_snippets` (
	`id` text NOT NULL,
	`scope_type` text DEFAULT 'user' NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`trigger` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`scope_type`, `scope_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_snippets`("id", "scope_type", "scope_id", "trigger", "content", "created_at", "updated_at") SELECT "id", 'user', '', "trigger", "content", "created_at", "updated_at" FROM `snippets`;--> statement-breakpoint
DROP TABLE `snippets`;--> statement-breakpoint
ALTER TABLE `__new_snippets` RENAME TO `snippets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `snippets_scope_trigger_unique` ON `snippets` (`scope_type`,`scope_id`,`trigger`);--> statement-breakpoint
CREATE TABLE `__new_vocabulary` (
	`id` text NOT NULL,
	`scope_type` text DEFAULT 'user' NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`word` text NOT NULL,
	`replacement_word` text,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`usage_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`scope_type`, `scope_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_vocabulary`("id", "scope_type", "scope_id", "word", "replacement_word", "date_added", "usage_count", "created_at", "updated_at") SELECT "id", 'user', '', "word", "replacement_word", "date_added", "usage_count", "created_at", "updated_at" FROM `vocabulary`;--> statement-breakpoint
DROP TABLE `vocabulary`;--> statement-breakpoint
ALTER TABLE `__new_vocabulary` RENAME TO `vocabulary`;--> statement-breakpoint
CREATE UNIQUE INDEX `vocabulary_scope_word_unique` ON `vocabulary` (`scope_type`,`scope_id`,`word`);
