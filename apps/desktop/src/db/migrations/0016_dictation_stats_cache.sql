ALTER TABLE `daily_stats` RENAME TO `daily_stats_backup`;
--> statement-breakpoint
CREATE TABLE `dictation_stats` (
	`scope` text PRIMARY KEY NOT NULL,
	`total_words` integer DEFAULT 0 NOT NULL,
	`total_transcriptions` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Daily counters include deleted history and remain authoritative, including zero.
INSERT INTO `dictation_stats` (`scope`, `total_words`, `total_transcriptions`)
SELECT 'device', COALESCE(SUM(`word_count`), 0), COALESCE(SUM(`transcription_count`), 0)
FROM `daily_stats_backup`;
--> statement-breakpoint
-- Only installs that never populated daily counters need a retained-history seed.
UPDATE `dictation_stats`
SET `total_words` = (
	SELECT COALESCE(SUM(amical_count_words(`text`, COALESCE(`detected_language`, `language`))), 0)
	FROM `transcriptions` WHERE `disposition` IS NOT NULL
), `total_transcriptions` = (
	SELECT COUNT(*) FROM `transcriptions` WHERE `disposition` IS NOT NULL
)
WHERE `scope` = 'device'
	AND NOT EXISTS (SELECT 1 FROM `daily_stats_backup`)
	AND COALESCE((SELECT json_extract(`data`, '$.dataMigrations.dictationDailyStats') FROM `app_settings` WHERE `id` = 1), 0) < 1;
