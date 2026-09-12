CREATE TABLE `processed_gift_wraps` (
	`id` text PRIMARY KEY NOT NULL,
	`account_pubkey` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pgw_account` ON `processed_gift_wraps` (`account_pubkey`);