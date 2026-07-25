CREATE TABLE `__new_vocabulary` (
	`id` text PRIMARY KEY NOT NULL,
	`word` text NOT NULL,
	`replacement_word` text,
	`is_replacement` integer DEFAULT false,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`usage_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_vocabulary` (
	`id`,
	`word`,
	`replacement_word`,
	`is_replacement`,
	`date_added`,
	`usage_count`,
	`created_at`,
	`updated_at`
)
SELECT
	lower(
		substr(printf('%016x', `id`), -8) || '-' ||
		hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', abs(random() % 4) + 1, 1) ||
		substr(hex(randomblob(2)), 2) || '-' ||
		hex(randomblob(6))
	),
	`word`,
	`replacement_word`,
	`is_replacement`,
	`date_added`,
	`usage_count`,
	`created_at`,
	`updated_at`
FROM `vocabulary`;--> statement-breakpoint
DROP TABLE `vocabulary`;--> statement-breakpoint
ALTER TABLE `__new_vocabulary` RENAME TO `vocabulary`;--> statement-breakpoint
CREATE UNIQUE INDEX `vocabulary_word_unique` ON `vocabulary` (`word`);--> statement-breakpoint
CREATE TABLE `__new_snippets` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_snippets` (`id`, `trigger`, `content`, `created_at`, `updated_at`)
SELECT
	lower(
		substr(printf('%016x', `id`), -8) || '-' ||
		hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', abs(random() % 4) + 1, 1) ||
		substr(hex(randomblob(2)), 2) || '-' ||
		hex(randomblob(6))
	),
	`trigger`,
	`content`,
	`created_at`,
	`updated_at`
FROM `snippets`;--> statement-breakpoint
DROP TABLE `snippets`;--> statement-breakpoint
ALTER TABLE `__new_snippets` RENAME TO `snippets`;--> statement-breakpoint
CREATE UNIQUE INDEX `snippets_trigger_unique` ON `snippets` (`trigger`);--> statement-breakpoint
CREATE TABLE `sync_client_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_outbox_sequence` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `sync_client_state` (`id`, `last_outbox_sequence`)
VALUES (1, 0);
--> statement-breakpoint
CREATE TABLE `sync_item_state` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`collection` text NOT NULL,
	`sync_id` text NOT NULL,
	`accepted_sync_version` integer,
	`accepted_payload` text,
	PRIMARY KEY(`scope_type`, `scope_id`, `collection`, `sync_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`collection` text NOT NULL,
	`sync_id` text NOT NULL,
	`desired_payload` text,
	`desired_base_sync_version` integer,
	`desired_sequence` integer NOT NULL,
	`desired_parent_head_sequence` integer,
	`desired_parent_sync_version` integer,
	`head_present` integer DEFAULT false NOT NULL,
	`head_payload` text,
	`head_expected_sync_version` integer,
	`head_sequence` integer,
	PRIMARY KEY(`scope_type`, `scope_id`, `collection`, `sync_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_collection_state` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`collection` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scope_type`, `scope_id`, `collection`)
);
