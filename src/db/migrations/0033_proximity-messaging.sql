CREATE TABLE `proximity_accounts` (
	`account_pubkey` text PRIMARY KEY NOT NULL,
	`proximity_pubkey` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proximity_accounts_proximity_pubkey_unique` ON `proximity_accounts` (`proximity_pubkey`);--> statement-breakpoint
CREATE TABLE `proximity_peers` (
	`account_pubkey` text NOT NULL,
	`proximity_pubkey` text NOT NULL,
	`display_name` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `proximity_pubkey`)
);
--> statement-breakpoint
CREATE INDEX `idx_proximity_peer_seen` ON `proximity_peers` (`account_pubkey`,`last_seen_at`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `delivery_kind` text DEFAULT 'relay' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox` ADD `conversation_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox` ADD `delivery_kind` text DEFAULT 'relay' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox` ADD `next_attempt_at` integer;--> statement-breakpoint
CREATE INDEX `idx_outbox_drain` ON `outbox` (`account_pubkey`,`delivery_kind`,`conversation_key`,`status`,`next_attempt_at`,`updated_at`);