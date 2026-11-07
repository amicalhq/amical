ALTER TABLE `transcriptions` ADD `activity_pending` integer DEFAULT true NOT NULL;
--> statement-breakpoint
-- Preserve prior scan progress and immutable outbox payloads. Provisional rows
-- remain pending so successful settlement can be found without a notification.
UPDATE `transcriptions` SET `activity_pending` = 0
WHERE `disposition` IS NOT NULL AND (
  `id` <= COALESCE((SELECT `transcription_cursor` FROM `activity_materialization_state` WHERE `id` = 1), 0)
  OR EXISTS (SELECT 1 FROM `activity_outbox` WHERE `activity_id` = `transcriptions`.`session_id`)
);
--> statement-breakpoint
CREATE TABLE `__new_activity_materialization_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` text,
	CONSTRAINT "activity_materialization_state_singleton_check" CHECK("__new_activity_materialization_state"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_activity_materialization_state`("id", "account_id") SELECT "id", "account_id" FROM `activity_materialization_state`;--> statement-breakpoint
DROP TABLE `activity_materialization_state`;--> statement-breakpoint
ALTER TABLE `__new_activity_materialization_state` RENAME TO `activity_materialization_state`;--> statement-breakpoint
CREATE INDEX `transcriptions_activity_pending_idx` ON `transcriptions` (`created_at`,`id`) WHERE "transcriptions"."activity_pending" = 1 AND "transcriptions"."disposition" = 'success';
