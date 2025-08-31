ALTER TABLE `vocabulary` ADD `replacement_word` text;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `is_replacement` integer DEFAULT false;