PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_models` (
	`id` text NOT NULL,
	`provider_type` text NOT NULL,
	`provider_instance_id` text NOT NULL,
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
	PRIMARY KEY(`provider_instance_id`, `type`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_models`(
	"id",
	"provider_type",
	"provider_instance_id",
	"provider",
	"name",
	"type",
	"size",
	"context",
	"description",
	"local_path",
	"size_bytes",
	"checksum",
	"downloaded_at",
	"original_model",
	"speed",
	"accuracy",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	CASE
		WHEN "provider" = 'OpenRouter' THEN 'openrouter'
		WHEN "provider" = 'Ollama' THEN 'ollama'
		WHEN "provider" = 'OpenAI Compatible' THEN 'openai-compatible'
		WHEN "provider" = 'local-whisper' THEN 'local-whisper'
		ELSE lower(replace("provider", ' ', '-'))
	END,
	CASE
		WHEN "provider" = 'OpenRouter' THEN 'system-openrouter'
		WHEN "provider" = 'Ollama' THEN 'system-ollama'
		WHEN "provider" = 'OpenAI Compatible' THEN 'system-openai-compatible'
		WHEN "provider" = 'local-whisper' THEN 'system-local-whisper'
		ELSE 'system-' || lower(replace("provider", ' ', '-'))
	END,
	"provider",
	"name",
	"type",
	"size",
	"context",
	"description",
	"local_path",
	"size_bytes",
	"checksum",
	"downloaded_at",
	"original_model",
	"speed",
	"accuracy",
	"created_at",
	"updated_at"
FROM `models`;--> statement-breakpoint
DROP TABLE `models`;--> statement-breakpoint
ALTER TABLE `__new_models` RENAME TO `models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `models_provider_type_idx` ON `models` (`provider_type`);--> statement-breakpoint
CREATE INDEX `models_provider_instance_idx` ON `models` (`provider_instance_id`);--> statement-breakpoint
CREATE INDEX `models_type_idx` ON `models` (`type`);
