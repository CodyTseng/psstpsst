CREATE TABLE `replaceable_events` (
	`pubkey` text NOT NULL,
	`kind` integer NOT NULL,
	`d_tag` text DEFAULT '' NOT NULL,
	`event` text,
	`created_at` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`pubkey`, `kind`, `d_tag`)
);
--> statement-breakpoint
CREATE INDEX `idx_replaceable_events_pubkey_kind` ON `replaceable_events` (`pubkey`,`kind`);
--> statement-breakpoint
INSERT INTO `replaceable_events` (`pubkey`, `kind`, `d_tag`, `event`, `created_at`, `fetched_at`)
	SELECT `account_pubkey`, 10030, '', `event`, `created_at`, `fetched_at` FROM `user_emoji_lists`;
--> statement-breakpoint
INSERT INTO `replaceable_events` (`pubkey`, `kind`, `d_tag`, `event`, `created_at`, `fetched_at`)
	SELECT `author_pubkey`, 30030, `identifier`, `event`, `created_at`, `fetched_at` FROM `emoji_sets`;
--> statement-breakpoint
INSERT INTO `replaceable_events` (`pubkey`, `kind`, `d_tag`, `event`, `created_at`, `fetched_at`)
	SELECT `pubkey`, 10002, '', `event`, json_extract(`event`, '$.created_at'), `fetched_at`
	FROM `peer_relay_metadata` WHERE `event` IS NOT NULL;
--> statement-breakpoint
-- Migrate the pure-miss rows too, preserving the negative cache.
INSERT INTO `replaceable_events` (`pubkey`, `kind`, `d_tag`, `event`, `created_at`, `fetched_at`)
	SELECT `pubkey`, 10002, '', NULL, NULL, `fetched_at` FROM `peer_relay_metadata` WHERE `event` IS NULL;