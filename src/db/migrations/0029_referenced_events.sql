CREATE TABLE `referenced_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`fetched_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_referenced_events_fetched_at` ON `referenced_events` (`fetched_at`);
