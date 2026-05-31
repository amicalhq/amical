CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mode` text DEFAULT 'preset' NOT NULL,
	`preset` text,
	`prompt` text,
	`tone` text,
	`included_apps` text,
	`included_sites` text,
	`is_default` integer DEFAULT false NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "skills_mode_consistency" CHECK(("skills"."mode" = 'preset' AND "skills"."preset" IS NOT NULL AND "skills"."prompt" IS NULL)
         OR ("skills"."mode" = 'custom' AND "skills"."prompt" IS NOT NULL AND "skills"."preset" IS NULL))
);
