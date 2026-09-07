-- Keep the ID mapping only for this migration. Recovery updates must follow
-- their note when the integer primary key is replaced by a prefixed CUID2.
CREATE TABLE `__note_id_map` (`old_id` integer PRIMARY KEY NOT NULL, `id` text NOT NULL UNIQUE);
--> statement-breakpoint
INSERT INTO `__note_id_map` (`old_id`, `id`)
SELECT `id`, amical_note_id() FROM `notes`;
--> statement-breakpoint
CREATE TABLE `__new_notes` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `content` text DEFAULT '',
  `icon` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notes` (`id`, `title`, `content`, `icon`, `created_at`, `updated_at`)
SELECT m.`id`, n.`title`, n.`content`, n.`icon`, n.`created_at`, n.`updated_at`
FROM `notes` n JOIN `__note_id_map` m ON m.`old_id` = n.`id`;
--> statement-breakpoint
CREATE TABLE `__saved_yjs_updates` AS
SELECT y.`id`, m.`id` AS `note_id`, y.`update_data`, y.`created_at`
FROM `yjs_updates` y JOIN `__note_id_map` m ON m.`old_id` = y.`note_id`;
--> statement-breakpoint
DROP TABLE `yjs_updates`;
--> statement-breakpoint
DROP TABLE `notes`;
--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;
--> statement-breakpoint
CREATE TABLE `yjs_updates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `note_id` text NOT NULL,
  `update_data` blob NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `yjs_updates` (`id`, `note_id`, `update_data`, `created_at`)
SELECT `id`, `note_id`, `update_data`, `created_at` FROM `__saved_yjs_updates`;
--> statement-breakpoint
CREATE INDEX `yjs_updates_note_id_idx` ON `yjs_updates` (`note_id`);
--> statement-breakpoint
DROP TABLE `__saved_yjs_updates`;
--> statement-breakpoint
DROP TABLE `__note_id_map`;
