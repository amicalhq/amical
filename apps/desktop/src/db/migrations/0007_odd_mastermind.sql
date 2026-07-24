CREATE TABLE `sync_client_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`sync_user_scope_id` text,
	`session_epoch` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `sync_client_state` (`id`, `sync_user_scope_id`, `session_epoch`)
VALUES (1, NULL, 0);
--> statement-breakpoint
CREATE TABLE `sync_item_state` (
	`account_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`collection` text NOT NULL,
	`sync_id` text NOT NULL,
	`local_row_id` integer,
	`accepted_sync_version` integer,
	`accepted_payload` text,
	`last_local_generation` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `scope_type`, `scope_id`, `collection`, `sync_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_item_state_local_row_idx` ON `sync_item_state` (`account_id`,`scope_type`,`scope_id`,`collection`,`local_row_id`);--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`account_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`collection` text NOT NULL,
	`sync_id` text NOT NULL,
	`desired_payload` text,
	`desired_base_sync_version` integer,
	`desired_generation` integer NOT NULL,
	`desired_parent_head_generation` integer,
	`desired_parent_sync_version` integer,
	`head_present` integer DEFAULT false NOT NULL,
	`head_payload` text,
	`head_expected_sync_version` integer,
	`head_generation` integer,
	PRIMARY KEY(`account_id`, `scope_type`, `scope_id`, `collection`, `sync_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_scope_state` (
	`account_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`response_epoch` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `scope_type`, `scope_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_collection_state` (
	`account_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`collection` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `scope_type`, `scope_id`, `collection`)
);
