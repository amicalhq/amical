CREATE TABLE `vocabulary_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`replacement_word` text,
	`rationale` text,
	`context_snippet` text,
	`transcription_id` integer,
	`source` text DEFAULT 'mcp' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`vocabulary_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `vocabulary_proposals_status_idx` ON `vocabulary_proposals` (`status`,`created_at`);