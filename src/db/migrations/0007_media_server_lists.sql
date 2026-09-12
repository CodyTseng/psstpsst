CREATE TABLE `media_server_lists` (
	`account_pubkey` text NOT NULL,
	`server_url` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `server_url`)
);
--> statement-breakpoint
CREATE INDEX `idx_media_server_lists_account` ON `media_server_lists` (`account_pubkey`);
