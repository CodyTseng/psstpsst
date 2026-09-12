CREATE TABLE `emoji_sets` (
	`coordinate` text PRIMARY KEY NOT NULL,
	`author_pubkey` text NOT NULL,
	`identifier` text NOT NULL,
	`title` text NOT NULL,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_emoji_sets_author` ON `emoji_sets` (`author_pubkey`);
--> statement-breakpoint
CREATE INDEX `idx_emoji_sets_created_at` ON `emoji_sets` (`created_at`);
--> statement-breakpoint
CREATE TABLE `user_emoji_lists` (
	`account_pubkey` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
