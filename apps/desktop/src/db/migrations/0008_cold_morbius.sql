ALTER TABLE `transcriptions` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `transcriptions` ADD `disposition` text;--> statement-breakpoint
ALTER TABLE `transcriptions` ADD `audible` integer;--> statement-breakpoint
CREATE INDEX `transcriptions_session_id_idx` ON `transcriptions` (`session_id`);--> statement-breakpoint
UPDATE `transcriptions` SET `session_id` = json_extract(`meta`, '$.sessionId') WHERE `session_id` IS NULL;--> statement-breakpoint
UPDATE `transcriptions` SET `disposition` = CASE COALESCE(json_extract(`meta`, '$.status'), 'success') WHEN 'failed' THEN 'failure' WHEN 'dismissed' THEN 'dismissed' ELSE 'success' END WHERE `disposition` IS NULL;