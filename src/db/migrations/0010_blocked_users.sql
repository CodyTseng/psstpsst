CREATE TABLE `blocked_users` (
	`account_pubkey` text NOT NULL,
	`pubkey` text NOT NULL,
	`blocked_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `pubkey`)
);
--> statement-breakpoint
CREATE INDEX `idx_blocked_account` ON `blocked_users` (`account_pubkey`);
